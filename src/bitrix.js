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

/**
 * Список активных задач. На вашем портале работает старый API task.item.*,
 * новый tasks.task.* тоже пробуем как запасной вариант.
 */
export async function listActiveTasks() {
  if (mockMode) return mockTasks;

  const activeFilter = { REAL_STATUS: [2, 3, 4] };
  const select = [
    'ID',
    'TITLE',
    'STATUS',
    'REAL_STATUS',
    'DEADLINE',
    'RESPONSIBLE_ID',
    'GROUP_ID',
  ];

  const attempts = [
    async () =>
      call('task.item.getlist', {
        ORDER: { ID: 'desc' },
        FILTER: activeFilter,
        PARAMS: { NAV_PARAMS: { nPageSize: 50 } },
        SELECT: select,
      }),
    async () =>
      call('task.item.list', {
        ORDER: { ID: 'desc' },
        FILTER: activeFilter,
        SELECT: select,
        PARAMS: { NAV_PARAMS: { nPageSize: 50 } },
      }),
    async () =>
      call('tasks.task.list', {
        order: { ID: 'desc' },
        filter: activeFilter,
        select,
        start: 0,
      }),
  ];

  let lastError;
  for (const attempt of attempts) {
    try {
      const result = await attempt();
      return asTaskArray(result).map(normalizeTask);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error('Не удалось получить список задач');
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
  const lines = [
    'Ежедневный отчёт по объекту/задаче',
    `Дата: ${report.date}`,
    report.authorName ? `Автор: ${report.authorName}` : null,
    '',
    'Выполненные работы:',
    report.works.trim(),
    '',
    'Проблемы / замечания:',
    report.problems?.trim() ? report.problems.trim() : '— нет',
    '',
    `Количество людей: ${report.peopleCount}`,
  ];

  if (report.equipment?.trim()) {
    lines.push('', 'Техника / оборудование:', report.equipment.trim());
  }
  if (report.materials?.trim()) {
    lines.push('', 'Материалы:', report.materials.trim());
  }
  if (report.progress?.toString().trim()) {
    lines.push('', `Оценка готовности: ${report.progress}%`);
  }
  if (report.notes?.trim()) {
    lines.push('', 'Дополнительно:', report.notes.trim());
  }

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
