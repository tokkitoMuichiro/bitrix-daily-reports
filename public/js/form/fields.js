import { state } from '../state.js';
import { dom } from '../dom.js';
import { todayLocal } from '../utils/dates.js';
import { applySelectedWorkItems, readSelectedWorkItems } from './work-items.js';

/** @type {(() => void) | null} */
let onDroneChange = null;

/** Чтобы fields не импортировал drafts (разрыв цикла). */
export function setDroneChangeHandler(fn) {
  onDroneChange = typeof fn === 'function' ? fn : null;
}

export function collectDronePeriods() {
  const { dronePeriodsEl } = dom();
  return [...dronePeriodsEl.querySelectorAll('.drone-period')]
    .map((row) => ({
      from: row.querySelector('[data-drone="from"]')?.value || '',
      to: row.querySelector('[data-drone="to"]')?.value || '',
    }))
    .filter((item) => item.from || item.to);
}

export function readFormValues() {
  const { reportForm } = dom();
  const values = Object.fromEntries(new FormData(reportForm).entries());
  values.workItems = readSelectedWorkItems();
  values.dronePeriods = collectDronePeriods();
  values.droneFrom = values.dronePeriods[0]?.from || '';
  values.droneTo = values.dronePeriods[0]?.to || '';
  return values;
}

export function addDronePeriodRow(from = '', to = '') {
  const { dronePeriodsEl } = dom();
  const row = document.createElement('div');
  row.className = 'drone-period';
  row.innerHTML = `
    <label>
      <span>С</span>
      <input type="time" data-drone="from" value="${from}" />
    </label>
    <label>
      <span>По</span>
      <input type="time" data-drone="to" value="${to}" />
    </label>
    <button type="button" class="ghost compact remove-drone" aria-label="Удалить период">−</button>
  `;
  row.querySelector('.remove-drone').addEventListener('click', () => {
    if (dronePeriodsEl.querySelectorAll('.drone-period').length <= 1) {
      row.querySelector('[data-drone="from"]').value = '';
      row.querySelector('[data-drone="to"]').value = '';
      onDroneChange?.();
      return;
    }
    row.remove();
    onDroneChange?.();
  });
  dronePeriodsEl.append(row);
}

export function setDronePeriods(periods) {
  const { dronePeriodsEl } = dom();
  dronePeriodsEl.innerHTML = '';
  const list = Array.isArray(periods) && periods.length ? periods : [{ from: '', to: '' }];
  for (const item of list) {
    addDronePeriodRow(item.from || '', item.to || '');
  }
}

export function fillFormFields(data, { keepDate = true, keepAuthor = true } = {}) {
  const d = dom();
  const map = {
    date: 'date',
    authorName: 'author-name',
    workStartFrom: 'work-start-from',
    workStartTo: 'work-start-to',
    estimatedCompletion: 'estimated-completion',
    staffItr: 'staff-itr',
    staffForemen: 'staff-foremen',
    staffWorkers: 'staff-workers',
    workStage: 'work-stage',
    techMeans: 'tech-means',
    volumes: 'volumes',
    ppe: 'ppe',
    nextDay: 'next-day',
    problems: 'problems',
  };

  for (const [key, id] of Object.entries(map)) {
    if (data[key] == null) continue;
    if (key === 'date' && keepDate === false) continue;
    if (key === 'authorName' && keepAuthor && state.bitrixUserName) continue;
    const node = document.getElementById(id);
    if (node) node.value = data[key];
  }

  const periods =
    Array.isArray(data.dronePeriods) && data.dronePeriods.length
      ? data.dronePeriods
      : data.droneFrom || data.droneTo
        ? [{ from: data.droneFrom || '', to: data.droneTo || '' }]
        : [{ from: '', to: '' }];
  setDronePeriods(periods);
  applySelectedWorkItems(data.workItems || []);

  if (keepAuthor && state.bitrixUserName) {
    d.authorNameInput.value = state.bitrixUserName;
  }
  if (!d.dateInput.value) {
    d.dateInput.value = todayLocal();
  }
}
