const ISO = /^\d{4}-\d{2}-\d{2}$/;
const WEEKDAYS = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
const MONTHS = [
  'январь',
  'февраль',
  'март',
  'апрель',
  'май',
  'июнь',
  'июль',
  'август',
  'сентябрь',
  'октябрь',
  'ноябрь',
  'декабрь',
];

export function isIsoDate(value) {
  if (!ISO.test(String(value || ''))) return false;
  const [y, m, d] = String(value).split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

export function weekdayIndex(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).getDay();
}

export function isWeekday(iso) {
  const day = weekdayIndex(iso);
  return day >= 1 && day <= 5;
}

export function addDays(iso, days) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  const pad = (n) => String(n).padStart(2, '0');
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}

export function eachDate(start, end) {
  const days = [];
  if (!isIsoDate(start) || !isIsoDate(end) || start > end) return days;
  let cursor = start;
  for (let i = 0; i < 1200 && cursor <= end; i += 1) {
    days.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return days;
}

export function dayMeta(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const wd = weekdayIndex(iso);
  return {
    date: iso,
    day: d,
    weekday: WEEKDAYS[wd],
    weekend: wd === 0 || wd === 6,
    monthKey: `${y}-${String(m).padStart(2, '0')}`,
    monthLabel: `${MONTHS[m - 1]} ${y}`,
  };
}

export function parseVolume(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const text = String(value ?? '')
    .trim()
    .replace(/\s/g, '')
    .replace(',', '.');
  if (!text) return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

export function formatVolume(value) {
  const n = parseVolume(value);
  if (n == null) return '';
  const rounded = Math.round(n * 1000) / 1000;
  if (Number.isInteger(rounded)) return String(rounded);
  return String(rounded);
}

export function normalizeScheduleItems(raw) {
  if (!Array.isArray(raw)) {
    throw new Error('Передайте список пунктов графика');
  }
  const items = [];
  const seen = new Set();
  for (const [index, row] of raw.entries()) {
    const label = `Пункт ${index + 1}`;
    const name = String(row?.name || '').trim();
    const unit = String(row?.unit || '').trim();
    const volumePlan = parseVolume(row?.volumePlan ?? row?.volume);
    const start = String(row?.start || '').trim();
    const end = String(row?.end || '').trim();
    if (!name) throw new Error(`${label}: укажите наименование`);
    if (!unit) throw new Error(`${label}: укажите единицу измерения`);
    if (volumePlan == null || volumePlan < 0) throw new Error(`${label}: укажите объём`);
    if (!isIsoDate(start) || !isIsoDate(end)) throw new Error(`${label}: укажите срок с и по`);
    if (end < start) throw new Error(`${label}: дата «по» раньше даты «с»`);
    let id = String(row?.id || '').trim();
    if (!id || seen.has(id)) id = crypto.randomUUID();
    seen.add(id);
    items.push({ id, name, unit, volumePlan, start, end });
  }
  return items;
}

export function planDates(item) {
  return eachDate(item.start, item.end).filter(isWeekday);
}

export function planWeekendDates(item) {
  return eachDate(item.start, item.end).filter((iso) => !isWeekday(iso));
}

export function buildBoard(items, facts) {
  const factMap = new Map();
  const factDates = [];
  for (const fact of facts || []) {
    if (!isIsoDate(fact.date) || !fact.itemId) continue;
    factDates.push(fact.date);
    if (!factMap.has(fact.itemId)) factMap.set(fact.itemId, new Map());
    const byDate = factMap.get(fact.itemId);
    const prev = byDate.get(fact.date) || 0;
    byDate.set(fact.date, prev + (parseVolume(fact.volume) || 0));
  }

  let min = null;
  let max = null;
  const consider = (iso) => {
    if (!isIsoDate(iso)) return;
    if (!min || iso < min) min = iso;
    if (!max || iso > max) max = iso;
  };
  for (const item of items) {
    consider(item.start);
    consider(item.end);
  }
  for (const date of factDates) consider(date);

  const days = min && max ? eachDate(min, max).map(dayMeta) : [];
  const rows = items.map((item, index) => {
    const byDate = factMap.get(item.id) || new Map();
    let volumeFact = 0;
    const fact = {};
    for (const [date, volume] of byDate) {
      fact[date] = volume;
      volumeFact += volume;
    }
    return {
      ...item,
      number: index + 1,
      volumeFact,
      plan: planDates(item),
      planWeekend: planWeekendDates(item),
      fact,
    };
  });

  return { days, items: rows };
}

const BULLET_WITH_ID =
  /^\s*•\s+(.+?)\s+—\s+([0-9]+(?:[.,][0-9]+)?)\s+(.+?)\s+\[id:([^\]]+)\]\s*$/;
const BULLET_PLAIN = /^\s*•\s+(.+?)\s+—\s+([0-9]+(?:[.,][0-9]+)?)\s+(\S+)\s*$/;

export function formatVolumesBlock(report) {
  const items = Array.isArray(report.workItems) ? report.workItems : [];
  const extra = String(report.volumes || '').trim();
  const lines = ['6. Выполненные объёмы работ:'];
  if (!items.length) {
    lines.push(extra);
    return lines;
  }
  for (const item of items) {
    const name = String(item.name || '').trim();
    const unit = String(item.unit || '').trim();
    lines.push(`   • ${name} — ${formatVolume(item.volume)} ${unit}`);
  }
  if (extra) {
    lines.push('', extra);
  }
  return lines;
}

export function formatWorkItemsSection() {
  return [];
}

function sectionChunk(text, label) {
  const idx = text.indexOf(label);
  if (idx < 0) return '';
  let rest = text.slice(idx + label.length);
  const next = rest.search(/\n\d+\.\s/);
  if (next >= 0) rest = rest.slice(0, next);
  return rest.replace(/^\s+/, '').replace(/\s+$/, '');
}

export function parseWorkItemsSection(content) {
  const text = String(content || '');
  const fromSix = [];
  const chunk = sectionChunk(text, '6. Выполненные объёмы работ:');
  for (const line of chunk.split('\n')) {
    if (!line.trim()) break;
    const plain = line.match(BULLET_PLAIN);
    if (!plain) break;
    fromSix.push({
      name: plain[1].trim(),
      volume: parseVolume(plain[2]),
      unit: plain[3].trim(),
      itemId: '',
    });
  }
  if (fromSix.length) return fromSix;

  const idx = text.search(/10\.\s*Пункты графика:/);
  if (idx < 0) return [];
  const items = [];
  for (const line of text.slice(idx).split('\n').slice(1)) {
    if (/^\d+\.\s/.test(line.trim())) break;
    const match = line.match(BULLET_WITH_ID);
    if (!match) continue;
    items.push({
      name: match[1].trim(),
      volume: parseVolume(match[2]),
      unit: match[3].trim(),
      itemId: match[4].trim(),
    });
  }
  return items;
}

export function freeVolumesText(content) {
  const chunk = sectionChunk(String(content || ''), '6. Выполненные объёмы работ:');
  if (!chunk) return '';
  const lines = chunk.split('\n');
  let index = 0;
  while (index < lines.length && BULLET_PLAIN.test(lines[index])) index += 1;
  if (index < lines.length && !lines[index].trim()) index += 1;
  return lines.slice(index).join('\n').trim();
}

export function normalizeIncomingWorkItems(raw) {
  if (!Array.isArray(raw)) return [];
  const items = [];
  for (const row of raw) {
    const itemId = String(row?.itemId || row?.id || '').trim();
    const volume = parseVolume(row?.volume);
    if (!itemId || volume == null || volume < 0) continue;
    items.push({ itemId, volume });
  }
  return items;
}
