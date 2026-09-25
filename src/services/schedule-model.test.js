import test from 'node:test';
import assert from 'node:assert/strict';
import { formatReportMessage } from './bitrix.js';
import {
  buildBoard,
  formatWorkItemsSection,
  normalizeScheduleItems,
  parseWorkItemsSection,
} from './schedule-model.js';

const baseReport = {
  date: '2026-08-04',
  authorName: 'Иванов',
  estimatedCompletion: '2026-08-30',
  workStartFrom: '08:00',
  workStartTo: '17:00',
  dronePeriods: [],
  staffItr: '1',
  staffForemen: '1',
  staffWorkers: '4',
  workStage: 'Откачка',
  techMeans: 'Насос',
  volumes: '12 м3',
  ppe: '',
  nextDay: 'Продолжить',
  problems: '',
};

test('отчёт без графика совпадает с прежним текстом', () => {
  const text = formatReportMessage(baseReport);
  assert.equal(text.includes('Пункты графика'), false);
  assert.match(text, /9\. Возникшие проблемы:\n— нет$/);
  assert.match(text, /2\. Беспилотная опасность: —/);
  assert.match(text, /6\. Выполненные объёмы работ:\n12 м3/);
});

test('объёмы из графика входят в пункт 6 без id', () => {
  const text = formatReportMessage({
    ...baseReport,
    volumes: 'ещё ветошь',
    workItems: [{ itemId: 'abc', name: 'Откачка', unit: 'м3', volume: 12 }],
  });
  assert.equal(text.includes('[id:'), false);
  assert.equal(text.includes('Пункты графика'), false);
  assert.match(text, /6\. Выполненные объёмы работ:\n {3}• Откачка — 12 м3\n\nещё ветошь/);
  assert.deepEqual(parseWorkItemsSection(text), [
    { name: 'Откачка', volume: 12, unit: 'м3', itemId: '' },
  ]);
  assert.deepEqual(parseWorkItemsSection(formatReportMessage(baseReport)), []);
});

test('план красит только будни, факт может быть в выходной', () => {
  const [item] = normalizeScheduleItems([
    {
      id: 'p1',
      name: 'Откачка',
      unit: 'м3',
      volumePlan: 100,
      start: '2026-08-07',
      end: '2026-08-10',
    },
  ]);
  const board = buildBoard([item], [{ date: '2026-08-08', itemId: 'p1', volume: 5 }]);
  const row = board.items[0];
  assert.deepEqual(row.plan, ['2026-08-07', '2026-08-10']);
  assert.equal(row.fact['2026-08-08'], 5);
  assert.equal(row.volumeFact, 5);
  assert.equal(board.days[0].date, '2026-08-07');
  assert.equal(board.days.at(-1).date, '2026-08-10');
  assert.equal(board.days.find((day) => day.date === '2026-08-08').weekend, true);
});

test('факт в выходной остаётся в board.fact', () => {
  const [item] = normalizeScheduleItems([
    {
      id: 'p1',
      name: 'Откачка',
      unit: 'м3',
      volumePlan: 100,
      start: '2026-08-07',
      end: '2026-08-10',
    },
  ]);
  const board = buildBoard([item], [{ date: '2026-08-09', itemId: 'p1', volume: 3 }]);
  assert.equal(board.items[0].fact['2026-08-09'], 3);
  assert.equal(board.days.find((day) => day.date === '2026-08-09').weekend, true);
});
