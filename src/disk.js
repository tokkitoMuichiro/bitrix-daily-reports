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
const mockRoot = path.join(__dirname, '../data/mock-disk');

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
