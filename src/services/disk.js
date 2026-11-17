import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import 'dotenv/config';

const webhookUrl = (process.env.BITRIX_WEBHOOK_URL || '').replace(/\/?$/, '/');
const webhookMissing = !webhookUrl || webhookUrl.includes('YOUR_PORTAL');
export const mockMode =
  process.env.MOCK_BITRIX === '1' ||
  process.env.MOCK_BITRIX === 'true' ||
  (webhookMissing && process.env.MOCK_BITRIX !== '0');

const REPORTS_FOLDER_NAME = process.env.DISK_REPORTS_FOLDER_NAME || 'Ежедневные отчёты';
const configuredFolderId = process.env.DISK_FOLDER_ID || '';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mockRoot = path.join(__dirname, '../../data/mock-disk');

let cachedRootFolderId = configuredFolderId || null;

async function call(method, params = {}) {
  if (webhookMissing) {
    throw new Error('Не настроен BITRIX_WEBHOOK_URL в файле .env');
  }

  const url = `${webhookUrl}${method}.json`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });

  const data = await response.json();
  if (data.error) {
    throw new Error(`Bitrix ${method}: ${data.error_description || data.error}`);
  }
  return data.result;
}

function objectFolderName(taskId) {
  return `task-${taskId}`;
}

function reportFileName(date) {
  return `${date}.txt`;
}

const SCHEDULE_FILE = 'schedule.json';
const SCHEDULE_FACTS_FILE = 'schedule-facts.json';

function sanitizeTitle(title) {
  return String(title || '')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
}

/* ---------- Mock (локальные файлы) ---------- */

async function mockEnsureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function mockSaveReport(taskId, taskTitle, date, content) {
  const dir = path.join(mockRoot, objectFolderName(taskId));
  await mockEnsureDir(dir);
  await fs.writeFile(path.join(dir, 'title.txt'), sanitizeTitle(taskTitle) || `Задача ${taskId}`, 'utf8');
  const filePath = path.join(dir, reportFileName(date));
  await fs.writeFile(filePath, content, 'utf8');
  return { path: filePath, mock: true };
}

async function mockListDates(taskId) {
  const dir = path.join(mockRoot, objectFolderName(taskId));
  try {
    const entries = await fs.readdir(dir);
    return entries
      .filter((name) => /^\d{4}-\d{2}-\d{2}\.txt$/.test(name))
      .map((name) => name.replace(/\.txt$/, ''))
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

async function mockReadReport(taskId, date) {
  const filePath = path.join(mockRoot, objectFolderName(taskId), reportFileName(date));
  try {
    const content = await fs.readFile(filePath, 'utf8');
    return { date, content, taskId: String(taskId) };
  } catch {
    return null;
  }
}

/* ---------- Bitrix Disk ---------- */

async function getCommonStorage() {
  const list = await call('disk.storage.getlist', {
    filter: { ENTITY_TYPE: 'common' },
  });
  const storages = Array.isArray(list) ? list : Object.values(list || {});
  const storage = storages[0];
  if (!storage) throw new Error('Не найден общий Диск компании в Битрикс');
  return storage;
}

function asItems(result) {
  if (!result) return [];
  if (Array.isArray(result)) return result;
  return Object.values(result);
}

function normalizeRuName(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/ё/g, 'е');
}

function namesMatch(a, b) {
  return normalizeRuName(a) === normalizeRuName(b);
}

/**
 * Ищем дочернюю папку по имени.
 * На общем диске много объектов — без фильтра/пагинации первую страницу легко «промахнуть».
 */
async function findChildFolder(parentId, name) {
  // 1) Точный фильтр по имени
  try {
    const filtered = await call('disk.folder.getchildren', {
      id: Number(parentId),
      filter: { NAME: name },
    });
    const hit = asItems(filtered).find((item) => namesMatch(item.NAME || item.name, name));
    if (hit) return hit;
  } catch {
    /* фильтр может не поддерживаться — идём пагинацией */
  }

  // 2) Пагинация по всем детям
  let start = 0;
  for (let page = 0; page < 40; page += 1) {
    const result = await call('disk.folder.getchildren', {
      id: Number(parentId),
      start,
    });
    const items = asItems(result);
    const found = items.find((item) => namesMatch(item.NAME || item.name, name));
    if (found) return found;
    if (items.length < 50) break;
    start += 50;
  }
  return null;
}

async function ensureSubfolder(parentId, name) {
  const existing = await findChildFolder(parentId, name);
  if (existing) return String(existing.ID ?? existing.id);

  try {
    const created = await call('disk.folder.addsubfolder', {
      id: Number(parentId),
      data: { NAME: name },
    });
    return String(created.ID ?? created.id);
  } catch (err) {
    // Папка уже есть, но мы её не нашли с первой попытки
    const message = String(err.message || '');
    if (message.includes('DISK_OBJ_22000') || message.includes('уже есть')) {
      const again = await findChildFolder(parentId, name);
      if (again) return String(again.ID ?? again.id);
    }
    throw err;
  }
}

async function resolveRootFolderId() {
  if (cachedRootFolderId) return cachedRootFolderId;
  if (configuredFolderId) {
    cachedRootFolderId = configuredFolderId;
    return cachedRootFolderId;
  }

  const storage = await getCommonStorage();
  const rootId = storage.ROOT_OBJECT_ID || storage.rootObjectId;
  cachedRootFolderId = await ensureSubfolder(rootId, REPORTS_FOLDER_NAME);
  return cachedRootFolderId;
}

async function ensureObjectFolder(taskId, taskTitle) {
  const rootId = await resolveRootFolderId();
  const folderName = objectFolderName(taskId);
  const folderId = await ensureSubfolder(rootId, folderName);

  // Читаемое имя — файл-метка внутри папки (имя папки стабильно по ID)
  try {
    const marker = `_${sanitizeTitle(taskTitle) || taskId}.name.txt`;
    const children = await call('disk.folder.getchildren', { id: Number(folderId) });
    const items = Array.isArray(children) ? children : Object.values(children || {});
    const hasMarker = items.some((i) => String(i.NAME || i.name || '').endsWith('.name.txt'));
    if (!hasMarker) {
      await uploadTextFile(folderId, marker, `Объект / задача: ${taskTitle}\nID: ${taskId}\n`);
    }
  } catch (err) {
    console.warn('[disk] не удалось записать метку объекта:', err.message);
  }

  return folderId;
}

async function findFileInFolder(folderId, fileName) {
  try {
    const filtered = await call('disk.folder.getchildren', {
      id: Number(folderId),
      filter: { NAME: fileName },
    });
    const hit = asItems(filtered).find((item) => namesMatch(item.NAME || item.name, fileName));
    if (hit) return hit;
  } catch {
    /* ignore */
  }

  const children = await call('disk.folder.getchildren', { id: Number(folderId) });
  return (
    asItems(children).find((item) => namesMatch(item.NAME || item.name, fileName)) || null
  );
}

async function uploadTextFile(folderId, fileName, content) {
  const existing = await findFileInFolder(folderId, fileName);
  if (existing) {
    // Обновляем содержимое: удаляем старый и загружаем новый (простой путь для .txt)
    try {
      await call('disk.file.delete', { id: Number(existing.ID ?? existing.id) });
    } catch (err) {
      console.warn('[disk] не удалось удалить старый файл:', err.message);
    }
  }

  const base64 = Buffer.from(content, 'utf8').toString('base64');
  return call('disk.folder.uploadfile', {
    id: Number(folderId),
    data: { NAME: fileName },
    fileContent: base64,
  });
}

async function downloadFileContent(file) {
  const fileId = Number(file.ID ?? file.id);
  const meta = await call('disk.file.get', { id: fileId });
  const downloadUrl = meta.DOWNLOAD_URL || meta.downloadUrl;
  if (!downloadUrl) {
    // Некоторые порталы отдают содержимое так:
    try {
      const content = await call('disk.file.getContent', { id: fileId });
      if (typeof content === 'string') return content;
    } catch {
      /* ignore */
    }
    throw new Error('Нет ссылки на скачивание файла отчёта');
  }

  const response = await fetch(downloadUrl);
  if (!response.ok) throw new Error(`Не удалось скачать отчёт (${response.status})`);
  return response.text();
}

/* ---------- Public API ---------- */

export async function saveReportToDisk(taskId, taskTitle, date, content) {
  if (mockMode) {
    return mockSaveReport(taskId, taskTitle, date, content);
  }

  const folderId = await ensureObjectFolder(taskId, taskTitle);
  const uploaded = await uploadTextFile(folderId, reportFileName(date), content);
  return {
    folderId,
    fileId: uploaded?.ID ?? uploaded?.id ?? null,
    fileName: reportFileName(date),
  };
}

export async function listReportDates(taskId) {
  if (mockMode) return mockListDates(taskId);

  const rootId = await resolveRootFolderId();
  const folder = await findChildFolder(rootId, objectFolderName(taskId));
  if (!folder) return [];

  const folderId = folder.ID ?? folder.id;
  const children = await call('disk.folder.getchildren', { id: Number(folderId) });
  const items = Array.isArray(children) ? children : Object.values(children || {});

  return items
    .filter((item) => item.TYPE === 'file' || item.type === 'file')
    .map((item) => item.NAME || item.name)
    .filter((name) => /^\d{4}-\d{2}-\d{2}\.txt$/.test(name))
    .map((name) => name.replace(/\.txt$/, ''))
    .sort()
    .reverse();
}

async function mockListReportObjects() {
  try {
    const entries = await fs.readdir(mockRoot, { withFileTypes: true });
    const objects = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const match = entry.name.match(/^task-(\d+)$/);
      if (!match) continue;
      const taskId = match[1];
      const dates = await mockListDates(taskId);
      if (!dates.length) continue;
      let title = `Задача #${taskId}`;
      try {
        title = (await fs.readFile(path.join(mockRoot, entry.name, 'title.txt'), 'utf8')).trim() || title;
      } catch {
        /* ignore */
      }
      objects.push({
        id: taskId,
        title,
        status: null,
        deadline: null,
        lastReportDate: dates[0],
        reportCount: dates.length,
      });
    }
    return objects.sort((a, b) => String(b.lastReportDate).localeCompare(String(a.lastReportDate)));
  } catch {
    return [];
  }
}

async function listAllChildFolders(parentId) {
  const folders = [];
  let start = 0;
  for (let page = 0; page < 40; page += 1) {
    const result = await call('disk.folder.getchildren', {
      id: Number(parentId),
      start,
    });
    const items = asItems(result);
    for (const item of items) {
      const type = item.TYPE || item.type;
      if (type === 'folder' || type === 'FOLDER') {
        folders.push(item);
      }
    }
    if (items.length < 50) break;
    start += 50;
  }
  return folders;
}

function titleFromMarkerName(name) {
  const raw = String(name || '');
  if (!raw.endsWith('.name.txt')) return null;
  return raw.replace(/^_/, '').replace(/\.name\.txt$/i, '').trim() || null;
}

async function resolveObjectTitle(folderId, taskId) {
  try {
    const children = await call('disk.folder.getchildren', { id: Number(folderId) });
    const items = asItems(children);
    const marker = items.find((item) =>
      String(item.NAME || item.name || '').endsWith('.name.txt')
    );
    const fromName = titleFromMarkerName(marker?.NAME || marker?.name);
    if (fromName) return fromName;

    const dates = items
      .map((item) => item.NAME || item.name)
      .filter((name) => /^\d{4}-\d{2}-\d{2}\.txt$/.test(name));
    if (!dates.length) return null;
    return `Задача #${taskId}`;
  } catch {
    return `Задача #${taskId}`;
  }
}

async function countReportDatesInFolder(folderId) {
  try {
    const children = await call('disk.folder.getchildren', { id: Number(folderId) });
    const dates = asItems(children)
      .map((item) => item.NAME || item.name)
      .filter((name) => /^\d{4}-\d{2}-\d{2}\.txt$/.test(name))
      .map((name) => name.replace(/\.txt$/, ''))
      .sort()
      .reverse();
    return {
      reportCount: dates.length,
      lastReportDate: dates[0] || null,
    };
  } catch {
    return { reportCount: 0, lastReportDate: null };
  }
}

/**
 * Объекты, по которым уже есть отчёты на Диске (любой статус задачи).
 */
export async function listReportObjectsPage({ query = '', start = 0, limit = 30 } = {}) {
  const pageSize = Math.min(50, Math.max(10, Number(limit) || 30));
  const offset = Math.max(0, Number(start) || 0);
  const q = String(query || '').trim().toLowerCase();

  let objects = mockMode ? await mockListReportObjects() : await listBitrixReportObjects();

  if (q) {
    objects = objects.filter((item) => {
      if (/^\d+$/.test(q)) return item.id === q;
      return item.title.toLowerCase().includes(q) || String(item.id).includes(q);
    });
  }

  const slice = objects.slice(offset, offset + pageSize);
  return {
    tasks: slice,
    nextStart: offset + slice.length,
    hasMore: offset + slice.length < objects.length,
  };
}

async function listBitrixReportObjects() {
  const rootId = await resolveRootFolderId();
  const folders = await listAllChildFolders(rootId);
  const objects = [];

  for (const folder of folders) {
    const name = String(folder.NAME || folder.name || '');
    const match = name.match(/^task-(\d+)$/i);
    if (!match) continue;

    const taskId = match[1];
    const folderId = folder.ID ?? folder.id;
    const { reportCount, lastReportDate } = await countReportDatesInFolder(folderId);
    if (!reportCount) continue;

    const title = (await resolveObjectTitle(folderId, taskId)) || `Задача #${taskId}`;
    objects.push({
      id: taskId,
      title,
      status: null,
      deadline: null,
      lastReportDate,
      reportCount,
    });
  }

  return objects.sort((a, b) => String(b.lastReportDate || '').localeCompare(String(a.lastReportDate || '')));
}

async function mockReadSchedule(taskId) {
  try {
    const raw = await fs.readFile(
      path.join(mockRoot, objectFolderName(taskId), SCHEDULE_FILE),
      'utf8'
    );
    const data = JSON.parse(raw);
    return Array.isArray(data.items) ? data.items : [];
  } catch {
    return [];
  }
}

async function mockWriteSchedule(taskId, taskTitle, items) {
  const dir = path.join(mockRoot, objectFolderName(taskId));
  await mockEnsureDir(dir);
  if (taskTitle) {
    await fs.writeFile(
      path.join(dir, 'title.txt'),
      sanitizeTitle(taskTitle) || `Задача ${taskId}`,
      'utf8'
    );
  }
  const filePath = path.join(dir, SCHEDULE_FILE);
  if (!items.length) {
    await fs.rm(filePath, { force: true });
    return { deleted: true, mock: true };
  }
  await fs.writeFile(filePath, JSON.stringify({ items }, null, 2), 'utf8');
  return { saved: true, mock: true };
}

async function readScheduleFile(taskId) {
  const rootId = await resolveRootFolderId();
  const folder = await findChildFolder(rootId, objectFolderName(taskId));
  if (!folder) return [];
  const folderId = folder.ID ?? folder.id;
  const file = await findFileInFolder(folderId, SCHEDULE_FILE);
  if (!file) return [];
  const content = await downloadFileContent(file);
  const data = JSON.parse(content);
  return Array.isArray(data.items) ? data.items : [];
}

export async function getSchedule(taskId) {
  if (mockMode) return mockReadSchedule(taskId);
  try {
    return await readScheduleFile(taskId);
  } catch (err) {
    console.warn('[disk] график не прочитан:', err.message);
    return [];
  }
}

export async function saveSchedule(taskId, taskTitle, items) {
  if (mockMode) {
    const result = await mockWriteSchedule(taskId, taskTitle, items);
    if (!items.length) await mockWriteScheduleFacts(taskId, taskTitle, null);
    return result;
  }
  const folderId = await ensureObjectFolder(taskId, taskTitle);
  if (!items.length) {
    const existing = await findFileInFolder(folderId, SCHEDULE_FILE);
    if (existing) {
      await call('disk.file.delete', { id: Number(existing.ID ?? existing.id) });
    }
    const facts = await findFileInFolder(folderId, SCHEDULE_FACTS_FILE);
    if (facts) {
      try {
        await call('disk.file.delete', { id: Number(facts.ID ?? facts.id) });
      } catch {
        /* ignore */
      }
    }
    return { deleted: true };
  }
  await uploadTextFile(folderId, SCHEDULE_FILE, JSON.stringify({ items }, null, 2));
  return { saved: true };
}

async function mockWriteScheduleFacts(taskId, taskTitle, payload) {
  const dir = path.join(mockRoot, objectFolderName(taskId));
  await mockEnsureDir(dir);
  const filePath = path.join(dir, SCHEDULE_FACTS_FILE);
  if (!payload) {
    await fs.rm(filePath, { force: true });
    return { deleted: true, mock: true };
  }
  if (taskTitle) {
    await fs.writeFile(
      path.join(dir, 'title.txt'),
      sanitizeTitle(taskTitle) || `Задача ${taskId}`,
      'utf8'
    );
  }
  await fs.writeFile(filePath, JSON.stringify(payload, null, 2), 'utf8');
  return { saved: true, mock: true };
}

async function mockReadScheduleFacts(taskId) {
  try {
    const raw = await fs.readFile(
      path.join(mockRoot, objectFolderName(taskId), SCHEDULE_FACTS_FILE),
      'utf8'
    );
    const data = JSON.parse(raw);
    return {
      facts: Array.isArray(data.facts) ? data.facts : [],
      reportDates: Array.isArray(data.reportDates) ? data.reportDates : [],
    };
  } catch {
    return null;
  }
}

async function readScheduleFactsFile(taskId) {
  const rootId = await resolveRootFolderId();
  const folder = await findChildFolder(rootId, objectFolderName(taskId));
  if (!folder) return null;
  const folderId = folder.ID ?? folder.id;
  const file = await findFileInFolder(folderId, SCHEDULE_FACTS_FILE);
  if (!file) return null;
  const content = await downloadFileContent(file);
  const data = JSON.parse(content);
  return {
    facts: Array.isArray(data.facts) ? data.facts : [],
    reportDates: Array.isArray(data.reportDates) ? data.reportDates : [],
  };
}

export async function getScheduleFacts(taskId) {
  if (mockMode) return mockReadScheduleFacts(taskId);
  try {
    return await readScheduleFactsFile(taskId);
  } catch (err) {
    console.warn('[disk] факты графика не прочитаны:', err.message);
    return null;
  }
}

export async function saveScheduleFacts(taskId, taskTitle, payload) {
  const body = {
    facts: Array.isArray(payload?.facts) ? payload.facts : [],
    reportDates: Array.isArray(payload?.reportDates) ? payload.reportDates : [],
    updatedAt: new Date().toISOString(),
  };
  if (mockMode) return mockWriteScheduleFacts(taskId, taskTitle, body);
  const folderId = await ensureObjectFolder(taskId, taskTitle);
  await uploadTextFile(folderId, SCHEDULE_FACTS_FILE, JSON.stringify(body, null, 2));
  return { saved: true };
}

/** Есть ли schedule.json, без скачивания содержимого. */
export async function scheduleExists(taskId) {
  if (mockMode) {
    try {
      await fs.access(path.join(mockRoot, objectFolderName(taskId), SCHEDULE_FILE));
      return true;
    } catch {
      return false;
    }
  }
  try {
    const rootId = await resolveRootFolderId();
    const folder = await findChildFolder(rootId, objectFolderName(taskId));
    if (!folder) return false;
    const file = await findFileInFolder(folder.ID ?? folder.id, SCHEDULE_FILE);
    return Boolean(file);
  } catch {
    return false;
  }
}

export async function schedulesPresence(taskIds) {
  const presence = {};
  await Promise.all(
    taskIds.map(async (taskId) => {
      const id = String(taskId);
      presence[id] = await scheduleExists(id);
    })
  );
  return presence;
}

/** Папка объекта на Диске (один раз на пересборку фактов). */
export async function getObjectFolderId(taskId) {
  if (mockMode) return objectFolderName(taskId);
  const rootId = await resolveRootFolderId();
  const folder = await findChildFolder(rootId, objectFolderName(taskId));
  return folder ? String(folder.ID ?? folder.id) : null;
}

export async function getReportFromFolder(folderId, taskId, date) {
  if (mockMode) return mockReadReport(taskId, date);
  if (!folderId) return null;
  const file = await findFileInFolder(folderId, reportFileName(date));
  if (!file) return null;
  const content = await downloadFileContent(file);
  return { date, content, taskId: String(taskId), fileId: file.ID ?? file.id };
}

export async function getReportFromDisk(taskId, date) {
  if (mockMode) return mockReadReport(taskId, date);

  const rootId = await resolveRootFolderId();
  const folder = await findChildFolder(rootId, objectFolderName(taskId));
  if (!folder) return null;

  const folderId = folder.ID ?? folder.id;
  const file = await findFileInFolder(folderId, reportFileName(date));
  if (!file) return null;

  const content = await downloadFileContent(file);
  return { date, content, taskId: String(taskId), fileId: file.ID ?? file.id };
}
