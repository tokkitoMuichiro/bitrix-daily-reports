import ExcelJS from 'exceljs';
import { formatVolume } from './schedule-model.js';

const PLAN = 'FFE85D4C';
const PLAN_WEEKEND = 'FFF2C94C';
const FACT = 'FF3E9B62';
const WEEKEND = 'FFF3F0EA';
const HEAD = 'FF1A2430';
const LINE = 'FFD5DEE8';
const TODAY = 'FF2F5D8A';

function fill(argb) {
  return { type: 'pattern', pattern: 'solid', fgColor: { argb } };
}

function thinBorder() {
  const edge = { style: 'thin', color: { argb: LINE } };
  return { top: edge, left: edge, bottom: edge, right: edge };
}

function monthSpans(days) {
  const spans = [];
  for (const day of days) {
    const last = spans.at(-1);
    if (!last || last.monthKey !== day.monthKey) {
      spans.push({ monthKey: day.monthKey, label: day.monthLabel, count: 1 });
    } else {
      last.count += 1;
    }
  }
  return spans;
}

export async function buildScheduleWorkbook({ title, board }) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'АММИР отчёт';
  const ws = wb.addWorksheet('График', {
    views: [{ state: 'frozen', xSplit: 5, ySplit: 4, showGridLines: false }],
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 1, paperSize: 9 },
  });

  const days = board.days || [];
  const items = board.items || [];
  const lastCol = 5 + Math.max(days.length, 1);

  ws.mergeCells(1, 1, 1, lastCol);
  const titleCell = ws.getCell(1, 1);
  titleCell.value = title || 'Месячно-суточный график';
  titleCell.font = { name: 'Calibri', size: 14, bold: true, color: { argb: 'FFFFFFFF' } };
  titleCell.fill = fill(HEAD);
  titleCell.alignment = { vertical: 'middle', wrapText: true };
  ws.getRow(1).height = 28;

  const headers = ['№', 'Наименование работ', 'Ед.', 'Объём', ''];
  headers.forEach((text, index) => {
    const cell = ws.getCell(3, index + 1);
    cell.value = text;
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
    cell.fill = fill(HEAD);
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = thinBorder();
    ws.mergeCells(3, index + 1, 4, index + 1);
  });

  let col = 6;
  for (const span of monthSpans(days)) {
    ws.mergeCells(3, col, 3, col + span.count - 1);
    const cell = ws.getCell(3, col);
    cell.value = span.label;
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
    cell.fill = fill(HEAD);
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    for (let i = 0; i < span.count; i += 1) {
      ws.getCell(3, col + i).fill = fill(HEAD);
      ws.getCell(3, col + i).border = thinBorder();
    }
    col += span.count;
  }

  days.forEach((day, index) => {
    const cell = ws.getCell(4, 6 + index);
    cell.value = `${day.day}\n${day.weekday}`;
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.font = { size: 8, color: { argb: day.weekend ? 'FF8A8178' : 'FF1A2430' } };
    cell.fill = fill(day.weekend ? WEEKEND : 'FFF7F9FB');
    cell.border = thinBorder();
    ws.getColumn(6 + index).width = 4.6;
  });
  ws.getRow(4).height = 28;

  ws.getColumn(1).width = 5;
  ws.getColumn(2).width = 42;
  ws.getColumn(3).width = 10;
  ws.getColumn(4).width = 12;
  ws.getColumn(5).width = 8;

  let rowIndex = 5;
  for (const item of items) {
    const planRow = rowIndex;
    const factRow = rowIndex + 1;
    const planSet = new Set(item.plan || []);
    const planWeekendSet = new Set(item.planWeekend || []);

    ws.mergeCells(planRow, 1, factRow, 1);
    ws.mergeCells(planRow, 2, factRow, 2);
    ws.mergeCells(planRow, 3, factRow, 3);

    const num = ws.getCell(planRow, 1);
    num.value = item.number;
    num.alignment = { horizontal: 'center', vertical: 'middle' };

    const name = ws.getCell(planRow, 2);
    name.value = item.name;
    name.alignment = { vertical: 'middle', wrapText: true };

    const unit = ws.getCell(planRow, 3);
    unit.value = item.unit;
    unit.alignment = { horizontal: 'center', vertical: 'middle' };

    const planVol = ws.getCell(planRow, 4);
    planVol.value = formatVolume(item.volumePlan);
    planVol.alignment = { horizontal: 'center', vertical: 'middle' };

    const factVol = ws.getCell(factRow, 4);
    factVol.value = formatVolume(item.volumeFact);
    factVol.alignment = { horizontal: 'center', vertical: 'middle' };

    ws.getCell(planRow, 5).value = 'план';
    ws.getCell(factRow, 5).value = 'факт';

    days.forEach((day, index) => {
      const planCell = ws.getCell(planRow, 6 + index);
      const factCell = ws.getCell(factRow, 6 + index);
      planCell.border = thinBorder();
      factCell.border = thinBorder();
      if (day.weekend) {
        planCell.fill = fill(WEEKEND);
        if (item.fact?.[day.date] == null) factCell.fill = fill(WEEKEND);
      }
      if (planSet.has(day.date)) planCell.fill = fill(PLAN);
      if (planWeekendSet.has(day.date)) planCell.fill = fill(PLAN_WEEKEND);
      if (item.fact?.[day.date] != null) factCell.fill = fill(FACT);
    });

    for (let c = 1; c <= 5; c += 1) {
      ws.getCell(planRow, c).border = thinBorder();
      ws.getCell(factRow, c).border = thinBorder();
      ws.getCell(planRow, c).font = { size: 10 };
      ws.getCell(factRow, c).font = { size: 10 };
    }
    ws.getCell(planRow, 5).font = { size: 9, color: { argb: 'FF9A3B32' }, bold: true };
    ws.getCell(factRow, 5).font = { size: 9, color: { argb: 'FF1F6B45' }, bold: true };
    ws.getRow(planRow).height = 18;
    ws.getRow(factRow).height = 18;
    rowIndex += 2;
  }

  ws.getCell(2, 1).value = 'Красный — план (пн–пт), жёлтый — выходные в периоде работ, зелёный — факт из ежедневных отчётов';
  ws.mergeCells(2, 1, 2, Math.min(lastCol, 8));
  ws.getCell(2, 1).font = { size: 9, italic: true, color: { argb: 'FF5A6B7D' } };

  void TODAY;
  return wb;
}
