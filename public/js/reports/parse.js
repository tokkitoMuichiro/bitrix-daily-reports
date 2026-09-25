import { parseHumanDate, normTime } from '../utils/dates.js';

/** Разбор сохранённого текста отчёта в поля формы. */
export function parseReportContent(content) {
  const text = String(content || '');
  const blockAfter = (label) => {
    const idx = text.indexOf(label);
    if (idx < 0) return '';
    let rest = text.slice(idx + label.length);
    const next = rest.search(/\n\d+\.\s/);
    if (next >= 0) rest = rest.slice(0, next);
    const chunk = rest.replace(/^\s+/, '').replace(/\s+$/, '');
    if (!chunk || chunk === '—' || chunk === '— нет') return '';
    return chunk;
  };

  const work = text.match(/1\.\s*Начало работ:\s*с\s*(\S+)\s*по\s*(\S+)/);
  const estimatedRaw =
    (text.match(/Предполагаемое завершение работ:\s*(.+)$/m) || [])[1]?.trim() || '';
  const estimatedCompletion = parseHumanDate(estimatedRaw);

  const droneBlock = (() => {
    const start = text.search(/2\.\s*Беспилотная опасность:/);
    if (start < 0) return '';
    const rest = text.slice(start);
    const cut = rest.search(/\n3\.\s/);
    return cut >= 0 ? rest.slice(0, cut) : rest;
  })();
  const dronePeriods = [...droneBlock.matchAll(/с\s*(\d{1,2}:\d{2})\s*по\s*(\d{1,2}:\d{2}|—)/g)].map(
    (match) => ({
      from: normTime(match[1]),
      to: match[2] === '—' ? '' : normTime(match[2]),
    })
  );

  return {
    authorName: (text.match(/^Составил:\s*(.+)$/m) || [])[1]?.trim() || '',
    estimatedCompletion,
    workStartFrom: normTime(work?.[1]),
    workStartTo: normTime(work?.[2]),
    dronePeriods,
    droneFrom: dronePeriods[0]?.from || '',
    droneTo: dronePeriods[0]?.to || '',
    staffItr: (text.match(/ИТР:\s*(.+)/) || [])[1]?.trim() || '',
    staffForemen: (text.match(/Бригадиры:\s*(.+)/) || [])[1]?.trim() || '',
    staffWorkers: (text.match(/Рабочие:\s*(.+)/) || [])[1]?.trim() || '',
    workStage: blockAfter('4. Этап работ:'),
    techMeans: blockAfter('5. Используемые технические средства (с зав. номерами):'),
    volumes: freeVolumes(blockAfter('6. Выполненные объёмы работ:')),
    ppe: blockAfter('7. Расход СИЗ:'),
    nextDay: blockAfter('8. Работы, запланированные на следующий день:'),
    problems: blockAfter('9. Возникшие проблемы:'),
    workItems: parseWorkItems(text),
  };
}

const BULLET_PLAIN = /^\s*•\s+(.+?)\s+—\s+([0-9]+(?:[.,][0-9]+)?)\s+(\S+)\s*$/;
const BULLET_WITH_ID =
  /^\s*•\s+(.+?)\s+—\s+([0-9]+(?:[.,][0-9]+)?)\s+(.+?)\s+\[id:([^\]]+)\]\s*$/;

function freeVolumes(chunk) {
  const lines = String(chunk || '').split('\n');
  let index = 0;
  while (index < lines.length && BULLET_PLAIN.test(lines[index])) index += 1;
  if (index < lines.length && !lines[index].trim()) index += 1;
  return lines.slice(index).join('\n').trim();
}

function parseWorkItems(text) {
  const label = '6. Выполненные объёмы работ:';
  const start = text.indexOf(label);
  let chunk = '';
  if (start >= 0) {
    let rest = text.slice(start + label.length);
    const next = rest.search(/\n\d+\.\s/);
    if (next >= 0) rest = rest.slice(0, next);
    chunk = rest.replace(/^\s+/, '').replace(/\s+$/, '');
  }
  const fromSix = [];
  for (const line of chunk.split('\n')) {
    if (!line.trim()) break;
    const plain = line.match(BULLET_PLAIN);
    if (!plain) break;
    fromSix.push({
      name: plain[1].trim(),
      volume: Number(plain[2].replace(',', '.')),
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
      volume: Number(match[2].replace(',', '.')),
      unit: match[3].trim(),
      itemId: match[4].trim(),
    });
  }
  return items;
}
