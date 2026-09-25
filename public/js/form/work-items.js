import { dom } from '../dom.js';
import { apiFetch } from '../api/client.js';
import { formatVolume } from './volume.js';

let catalog = [];
/** @type {Array<{ key: string, itemId: string, volume: string }>} */
let rows = [];

export function scheduleCatalog() {
  return catalog;
}

export function setWorkItemCatalog(items) {
  catalog = Array.isArray(items) ? items : [];
  rows = [];
  renderWorkItemPicker();
}

export async function refreshWorkItemCatalog(taskId) {
  if (!taskId) {
    setWorkItemCatalog([]);
    return;
  }
  try {
    const res = await apiFetch(`/api/schedules/${encodeURIComponent(taskId)}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'график');
    setWorkItemCatalog(data.items || []);
  } catch {
    setWorkItemCatalog([]);
  }
}

function blankRow() {
  return { key: crypto.randomUUID(), itemId: '', volume: '' };
}

function syncRowsFromDom() {
  const { scheduleItemsEl } = dom();
  rows = [...scheduleItemsEl.querySelectorAll('.work-item')].map((row) => ({
    key: row.dataset.key,
    itemId: row.querySelector('select')?.value || '',
    volume: row.querySelector('input')?.value || '',
  }));
}

function renderWorkItemPicker() {
  const { scheduleItemsBlock, scheduleItemsEl } = dom();
  const volumesLabel = document.getElementById('volumes-label');
  const volumesInput = document.getElementById('volumes');
  const addBtn = document.getElementById('add-work-item');
  if (!catalog.length) {
    scheduleItemsBlock.hidden = true;
    if (volumesLabel) volumesLabel.textContent = '6. Выполненные объёмы работ';
    if (volumesInput) volumesInput.required = true;
    return;
  }
  scheduleItemsBlock.hidden = false;
  if (volumesLabel) volumesLabel.textContent = 'Неучтённые объёмы работ';
  if (volumesInput) volumesInput.required = false;

  const taken = new Set(rows.map((row) => row.itemId).filter(Boolean));
  scheduleItemsEl.innerHTML = '';
  for (const row of rows) {
    const line = document.createElement('div');
    line.className = 'work-item';
    line.dataset.key = row.key;
    const select = document.createElement('select');
    select.className = 'work-item-select';
    const empty = document.createElement('option');
    empty.value = '';
    empty.textContent = 'Вид работ';
    select.append(empty);
    for (const item of catalog) {
      if (item.id !== row.itemId && taken.has(item.id)) continue;
      const option = document.createElement('option');
      option.value = item.id;
      option.textContent = item.name;
      select.append(option);
    }
    select.value = row.itemId;
    const volume = document.createElement('input');
    volume.type = 'number';
    volume.min = '0';
    volume.step = 'any';
    volume.className = 'work-item-volume';
    volume.placeholder = 'объём';
    volume.value = row.volume;
    const unit = document.createElement('span');
    unit.className = 'work-item-unit';
    unit.textContent = catalog.find((item) => item.id === row.itemId)?.unit || '';
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'ghost compact work-item-remove';
    remove.setAttribute('aria-label', 'Убрать вид работ');
    remove.textContent = 'Убрать';
    remove.addEventListener('click', () => {
      syncRowsFromDom();
      rows = rows.filter((item) => item.key !== row.key);
      renderWorkItemPicker();
    });
    select.addEventListener('change', () => {
      syncRowsFromDom();
      renderWorkItemPicker();
    });
    volume.addEventListener('input', () => {
      const current = rows.find((item) => item.key === row.key);
      if (current) current.volume = volume.value;
    });
    line.append(select, volume, unit, remove);
    scheduleItemsEl.append(line);
  }
  if (addBtn && !addBtn.dataset.bound) {
    addBtn.dataset.bound = '1';
    addBtn.addEventListener('click', () => {
      syncRowsFromDom();
      rows.push(blankRow());
      renderWorkItemPicker();
    });
  }
}

export function readSelectedWorkItems() {
  if (!catalog.length) return [];
  syncRowsFromDom();
  const selected = [];
  for (const row of rows) {
    const item = catalog.find((entry) => entry.id === row.itemId);
    if (!item) continue;
    selected.push({
      itemId: item.id,
      name: item.name,
      unit: item.unit,
      volume: row.volume,
    });
  }
  return selected;
}

export function workItemsError() {
  if (!catalog.length) return null;
  syncRowsFromDom();
  for (const [index, row] of rows.entries()) {
    if (!row.itemId) {
      return `Строка ${index + 1}: выберите вид работ`;
    }
    const volume = String(row.volume ?? '').trim().replace(',', '.');
    if (!volume || Number.isNaN(Number(volume)) || Number(volume) < 0) {
      const name = catalog.find((entry) => entry.id === row.itemId)?.name || 'вид работ';
      return `Укажите объём по виду работ «${name}»`;
    }
  }
  if (!rows.length) {
    const extra = document.getElementById('volumes')?.value?.trim();
    if (!extra) return 'Добавьте вид работ из графика или укажите неучтённые объёмы';
  }
  return null;
}

export function applySelectedWorkItems(workItems) {
  if (!catalog.length) return;
  const list = Array.isArray(workItems) ? workItems : [];
  rows = list
    .map((row) => {
      const item =
        catalog.find((entry) => entry.id === row.itemId) ||
        catalog.find((entry) => entry.name === row.name);
      if (!item) return null;
      return { key: crypto.randomUUID(), itemId: item.id, volume: formatVolume(row.volume) };
    })
    .filter(Boolean);
  renderWorkItemPicker();
}
