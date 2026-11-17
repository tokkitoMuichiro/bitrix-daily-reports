import {
  getObjectFolderId,
  getReportFromFolder,
  getSchedule,
  getScheduleFacts,
  listReportDates,
  saveScheduleFacts,
} from './disk.js';
import { buildBoard, parseWorkItemsSection } from './schedule-model.js';

const REBUILD_CONCURRENCY = 5;
/** @type {Set<string>} */
const rebuilding = new Set();

async function mapPool(items, limit, mapper) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await mapper(items[index], index);
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) || 1 }, () => worker());
  await Promise.all(workers);
  return results;
}

function normalizeFacts(rawFacts, items) {
  const byName = new Map(items.map((item) => [item.name.trim().toLowerCase(), item.id]));
  return (rawFacts || [])
    .map((fact) => ({
      ...fact,
      itemId: fact.itemId || byName.get(String(fact.name || '').trim().toLowerCase()) || '',
    }))
    .filter((fact) => fact.itemId && fact.date);
}

/** Полная пересборка фактов из отчётов. */
export async function rebuildScheduleFacts(taskId, taskTitle = '') {
  const dates = await listReportDates(taskId);
  const folderId = await getObjectFolderId(taskId);
  const facts = [];
  const reportDates = [];

  await mapPool(dates, REBUILD_CONCURRENCY, async (date) => {
    const report = await getReportFromFolder(folderId, taskId, date);
    if (!report?.content) return;
    reportDates.push(date);
    for (const item of parseWorkItemsSection(report.content)) {
      facts.push({
        date,
        itemId: item.itemId || '',
        volume: item.volume,
        name: item.name,
        unit: item.unit,
      });
    }
  });

  reportDates.sort().reverse();
  const payload = { facts, reportDates };
  try {
    await saveScheduleFacts(taskId, taskTitle || `Задача #${taskId}`, payload);
  } catch (err) {
    console.warn('[schedule] не удалось сохранить кэш фактов:', err.message);
  }
  return payload;
}

function startBackgroundRebuild(taskId, taskTitle) {
  const key = String(taskId);
  if (rebuilding.has(key)) return;
  rebuilding.add(key);
  rebuildScheduleFacts(key, taskTitle)
    .catch((err) => console.warn('[schedule] фоновая пересборка фактов:', err.message))
    .finally(() => rebuilding.delete(key));
}

export async function collectScheduleFacts(taskId, { taskTitle = '', forceRebuild = false } = {}) {
  if (!forceRebuild) {
    const cached = await getScheduleFacts(taskId);
    if (cached) return { ...cached, building: false };
  }
  // Без кэша не блокируем ответ на десятки запросов к Диску — план отдаём сразу.
  startBackgroundRebuild(taskId, taskTitle);
  return { facts: [], reportDates: [], building: true };
}

/**
 * Обновить кэш фактов за один день после сохранения отчёта.
 */
export async function upsertDayFacts(taskId, taskTitle, date, workItems = []) {
  let cached = await getScheduleFacts(taskId);
  if (!cached) {
    // Если кэша нет — полная пересборка в фоне, а день запишем поверх после неё сложно.
    // Сразу создаём минимальный кэш с этим днём, чтобы график ожил без ожидания архива.
    cached = { facts: [], reportDates: [] };
    startBackgroundRebuild(taskId, taskTitle);
  }

  const facts = (cached.facts || []).filter((fact) => fact.date !== date);
  for (const item of workItems || []) {
    facts.push({
      date,
      itemId: item.itemId || item.id || '',
      volume: item.volume,
      name: item.name,
      unit: item.unit,
    });
  }

  const reportDates = new Set(cached.reportDates || []);
  reportDates.add(date);
  const payload = {
    facts,
    reportDates: [...reportDates].sort().reverse(),
  };
  await saveScheduleFacts(taskId, taskTitle, payload);
  return payload;
}

export async function loadScheduleBoard(taskId, { taskTitle = '' } = {}) {
  const items = await getSchedule(taskId);
  if (!items.length) {
    return { hasSchedule: false, items: [], days: [], reportDates: [], factsBuilding: false };
  }
  const collected = await collectScheduleFacts(taskId, { taskTitle });
  const facts = normalizeFacts(collected.facts, items);
  const board = buildBoard(items, facts);
  return {
    hasSchedule: true,
    reportDates: collected.reportDates || [],
    factsBuilding: Boolean(collected.building),
    ...board,
  };
}
