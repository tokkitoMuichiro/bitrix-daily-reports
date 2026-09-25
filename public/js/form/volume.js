export function formatVolume(value) {
  const text = String(value ?? '')
    .trim()
    .replace(/\s/g, '')
    .replace(',', '.');
  if (!text) return '';
  const n = Number(text);
  if (!Number.isFinite(n)) return '';
  const rounded = Math.round(n * 1000) / 1000;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}
