import 'dotenv/config';
import { mockMode, saveReportToDisk, listReportDates, getReportFromDisk } from './disk.js';

export { mockMode, listReportDates, getReportFromDisk };

const webhookUrl = (process.env.BITRIX_WEBHOOK_URL || '').replace(/\/?$/, '/');
const webhookMissing = !webhookUrl || webhookUrl.includes('YOUR_PORTAL');
const alsoComment = process.env.SAVE_TASK_COMMENT !== '0';

const mockTasks = [
  {
    id: '101',
    title: 'Объект «Север» — фундамент, ось А-Б',
    status: 3,
    deadline: new Date(Date.now() + 86400000 * 3).toISOString(),
    responsibleId: '1',
    groupId: null,
  },
  {
    id: '102',
    title: 'Отделка офиса — 3 этаж',
    status: 2,
    deadline: new Date(Date.now() + 86400000 * 7).toISOString(),
    responsibleId: '1',
    groupId: null,
  },
  {
    id: '103',
    title: 'Кровля склада №2',
    status: 3,
    deadline: null,
    responsibleId: '2',
    groupId: null,
  },
];

if (mockMode) {
  console.warn('[bitrix] Демо-режим: отчёты пишутся в data/mock-disk/ (как на Диске).');
} else if (webhookMissing) {
  console.warn('[bitrix] BITRIX_WEBHOOK_URL не задан. Укажите вебхук в .env.');
}

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

function normalizeTask(raw) {
  const task = raw?.task || raw;
  return {
    id: String(task.id ?? task.ID),
    title: task.title || task.TITLE || `Задача #${task.id ?? task.ID}`,
    status: Number(task.realStatus ?? task.REAL_STATUS ?? task.status ?? task.STATUS),
    deadline: task.deadline || task.DEADLINE || null,
    responsibleId: task.responsibleId || task.RESPONSIBLE_ID || null,
    groupId: task.groupId || task.GROUP_ID || null,
  };
}

function asTaskArray(result) {
  if (!result) return [];
  if (Array.isArray(result)) return result;
  if (result.tasks) return Object.values(result.tasks);
  return Object.values(result);
}

const TASK_SELECT = [
  'ID',
  'TITLE',
  'STATUS',
  'REAL_STATUS',
  'DEADLINE',
  'RESPONSIBLE_ID',
  'GROUP_ID',
];

function buildActiveTaskFilter(query) {
  const filter = { REAL_STATUS: [2, 3, 4] };
  const q = String(query || '').trim();
  if (!q) return filter;

  if (/^\d+$/.test(q)) {
    filter.ID = Number(q);
    return filter;
  }

  filter['%TITLE'] = q;
  return filter;
}

/**
 * Страница активных задач (без загрузки всего списка).
 * @param {{ query?: string, start?: number, limit?: number }} opts
 */
export async function listActiveTasksPage({ query = '', start = 0, limit = 30 } = {}) {
  const pageSize = Math.min(50, Math.max(10, Number(limit) || 30));
  const offset = Math.max(0, Number(start) || 0);
  const pageNum = Math.floor(offset / pageSize) + 1;

  if (mockMode) {
    const q = String(query || '').trim().toLowerCase();
    let list = mockTasks.filter((t) => [2, 3, 4].includes(t.status));
    if (q) {
      if (/^\d+$/.test(q)) {
        list = list.filter((t) => t.id === q);
      } else {
        list = list.filter((t) => t.title.toLowerCase().includes(q));
      }
    }
    const slice = list.slice(offset, offset + pageSize);
    return {
      tasks: slice,
      nextStart: offset + slice.length,
      hasMore: offset + slice.length < list.length,
    };
  }

  const filter = buildActiveTaskFilter(query);

  const attempts = [
    async () =>
      call('task.item.getlist', {
        ORDER: { ID: 'desc' },
        FILTER: filter,
        PARAMS: { NAV_PARAMS: { nPageSize: pageSize, iNumPage: pageNum } },
        SELECT: TASK_SELECT,
      }),
    async () =>
      call('task.item.list', {
        ORDER: { ID: 'desc' },
        FILTER: filter,
        SELECT: TASK_SELECT,
        PARAMS: { NAV_PARAMS: { nPageSize: pageSize, iNumPage: pageNum } },
      }),
    async () =>
      call('tasks.task.list', {
        order: { ID: 'desc' },
        filter,
        select: TASK_SELECT,
        start: offset,
      }),
  ];

  let lastError;
  for (const attempt of attempts) {
    try {
      const result = await attempt();
      const tasks = asTaskArray(result).map(normalizeTask);
      return {
        tasks,
        nextStart: offset + tasks.length,
        hasMore: tasks.length >= pageSize,
      };
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error('Не удалось получить список задач');
}

/**
 * @deprecated Используйте listActiveTasksPage — полный список больше не грузим
 */
export async function listActiveTasks() {
  const { tasks } = await listActiveTasksPage({ start: 0, limit: 50 });
  return tasks;
}

export async function getTask(taskId) {
  if (mockMode) {
    const found = mockTasks.find((t) => t.id === String(taskId));
    if (!found) throw new Error(`Задача ${taskId} не найдена (демо)`);
    return { id: found.id, title: found.title };
  }

  const attempts = [
    async () => call('task.item.getdata', { TASKID: Number(taskId) }),
    async () =>
      call('tasks.task.get', {
        taskId: Number(taskId),
        select: ['ID', 'TITLE', 'STATUS', 'REAL_STATUS', 'RESPONSIBLE_ID'],
      }),
  ];

  let lastError;
  for (const attempt of attempts) {
    try {
      const result = await attempt();
      const task = normalizeTask(result);
      if (!task.id || task.id === 'undefined') throw new Error('Пустой ответ');
      return { id: task.id, title: task.title };
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error(`Задача ${taskId} не найдена`);
}

async function addReportComment(taskId, message) {
  if (mockMode) {
    return { mock: true };
  }

  return call('task.commentitem.add', {
    TASKID: Number(taskId),
    FIELDS: { POST_MESSAGE: message },
  });
}

export function formatReportMessage(report) {
  const droneLine =
    report.droneFrom || report.droneTo
      ? `Беспилотная опасность: с ${report.droneFrom || '—'} по ${report.droneTo || '—'}`
      : 'Беспилотная опасность: —';

  const lines = [
    'Ежедневный отчёт по объекту',
    `Дата: ${report.date}`,
    report.authorName ? `Составил: ${report.authorName}` : null,
    '',
    `1. Начало работ: с ${report.workStartFrom} по ${report.workStartTo}`,
    `2. ${droneLine}`,
    '',
    '3. Количество персонала на объекте:',
    `   ИТР: ${report.staffItr}`,
    `   Бригадиры: ${report.staffForemen}`,
    `   Рабочие: ${report.staffWorkers}`,
    '',
    '4. Этап работ:',
    report.workStage.trim(),
    '',
    '5. Используемые технические средства (с зав. номерами):',
    report.techMeans.trim(),
    '',
    '6. Выполненные объёмы работ:',
    report.volumes.trim(),
    '',
    '7. Расход СИЗ:',
    report.ppe?.trim() ? report.ppe.trim() : '—',
    '',
    '8. Работы, запланированные на следующий день:',
    report.nextDay.trim(),
    '',
    '9. Возникшие проблемы:',
    report.problems?.trim() ? report.problems.trim() : '— нет',
  ];

  return lines.filter((line) => line !== null).join('\n');
}

/**
 * Главное сохранение: файл на Диске Bitrix (или mock-папка).
 * По желанию — дубль комментарием к задаче.
 */
export async function saveReport(taskId, report) {
  const task = await getTask(taskId);
  const message = formatReportMessage(report);
  const disk = await saveReportToDisk(task.id, task.title, report.date, message);

  let commentId = null;
  if (alsoComment) {
    try {
      commentId = await addReportComment(task.id, message);
    } catch (err) {
      console.warn('[bitrix] комментарий к задаче не записан:', err.message);
    }
  }

  return { task, message, disk, commentId };
}
