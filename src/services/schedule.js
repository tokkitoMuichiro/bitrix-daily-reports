import { getReportFromDisk, getSchedule, listReportDates } from './disk.js';
import { buildBoard, parseWorkItemsSection } from './schedule-model.js';

export async function collectScheduleFacts(taskId) {
  const dates = await listReportDates(taskId);
  const facts = [];
  const reportDates = [];
  for (const date of dates) {
    const report = await getReportFromDisk(taskId, date);
    if (!report?.content) continue;
    reportDates.push(date);
    for (const item of parseWorkItemsSection(report.content)) {
      facts.push({
        date,
        itemId: item.itemId,
        volume: item.volume,
        name: item.name,
        unit: item.unit,
      });
    }
  }
  return { facts, reportDates };
}

export async function loadScheduleBoard(taskId) {
  const items = await getSchedule(taskId);
  if (!items.length) {
    return { hasSchedule: false, items: [], days: [], reportDates: [] };
  }
  const collected = await collectScheduleFacts(taskId);
  const byName = new Map(items.map((item) => [item.name.trim().toLowerCase(), item.id]));
  const facts = collected.facts
    .map((fact) => ({
      ...fact,
      itemId: fact.itemId || byName.get(String(fact.name || '').trim().toLowerCase()) || '',
    }))
    .filter((fact) => fact.itemId);
  const board = buildBoard(items, facts);
  const reportDates = collected.reportDates;
  return {
    hasSchedule: true,
    reportDates,
    ...board,
  };
}
