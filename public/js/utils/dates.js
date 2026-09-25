export function todayLocal() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function shiftDate(iso, days) {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + days);
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function formatDeadline(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' });
}

export function formatDateRu(iso) {
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}

export function parseHumanDate(value) {
  const raw = String(value || '').trim();
  if (!raw || raw === '—') return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const ru = raw.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (ru) return `${ru[3]}-${ru[2]}-${ru[1]}`;
  return '';
}

export function normTime(value) {
  if (!value || value === '—') return '';
  const text = String(value).trim();
  return text.length >= 5 ? text.slice(0, 5) : text;
}

export function archiveStatusText(task) {
  if (task.reportCount) {
    return task.lastReportDate
      ? `${task.reportCount} отч. · ${formatDateRu(task.lastReportDate)}`
      : `${task.reportCount} отч.`;
  }
  return 'С отчётами';
}
