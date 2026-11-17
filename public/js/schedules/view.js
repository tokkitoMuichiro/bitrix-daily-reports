import { state } from '../state.js';
import { dom } from '../dom.js';
import { apiFetch, readApiJson } from '../api/client.js';
import { formatDateRu, todayLocal } from '../utils/dates.js';
import { formatVolume } from '../form/volume.js';
import { hideAllWorkPanels } from '../ui/panels.js';
import { parseReportContent } from '../reports/parse.js';

let editorItems = [];

function pageEl() {
  return document.querySelector('.page');
}

let factsRefreshTimer = null;

function scheduleFactsRefresh(previous) {
  clearTimeout(factsRefreshTimer);
  let attempts = 0;
  factsRefreshTimer = setTimeout(async function tick() {
    attempts += 1;
    const task = state.currentTask;
    if (!task || state.mode !== 'schedules') return;
    try {
      const res = await apiFetch(`/api/schedules/${encodeURIComponent(task.id)}/board`);
      const data = await readApiJson(res);
      if (!res.ok) throw new Error(data.error || 'ошибка');
      if (!data.factsBuilding) {
        showBoard(data);
        return;
      }
      if (attempts < 8) {
        factsRefreshTimer = setTimeout(tick, 8000);
      } else {
        setScheduleStatus('Факт ещё собирается. Откройте график снова чуть позже.', {
          loading: true,
        });
      }
    } catch {
      if (attempts < 8) factsRefreshTimer = setTimeout(tick, 8000);
      else if (previous) showBoard({ ...previous, factsBuilding: false });
    }
  }, 5000);
}

function setWide(on) {
  pageEl()?.classList.toggle('page--wide', on);
}

function setScheduleStatus(message, { loading = false, error = false } = {}) {
  const el = dom().scheduleStatus;
  el.hidden = !message;
  el.classList.toggle('error', error);
  el.classList.toggle('is-loading', loading);
  el.replaceChildren();
  if (!message) return;
  if (loading) {
    const spin = document.createElement('span');
    spin.className = 'status-spinner';
    spin.setAttribute('aria-hidden', 'true');
    el.append(spin);
  }
  el.append(document.createTextNode(message));
}

function newItem() {
  return {
    id: crypto.randomUUID(),
    name: '',
    unit: '',
    volumePlan: '',
    start: '',
    end: '',
  };
}

export async function openSchedule(task) {
  const d = dom();
  state.currentTask = task;
  hideAllWorkPanels();
  d.schedulePanel.hidden = false;
  setWide(true);
  d.scheduleTitle.textContent = `${task.title} (#${task.id})`;
  d.scheduleEditor.hidden = true;
  d.scheduleBoardWrap.hidden = true;
  d.scheduleEmpty.hidden = true;
  setScheduleStatus('Загрузка графика…', { loading: true });
  d.scheduleExportBtn.hidden = true;
  d.scheduleEditBtn.hidden = true;

  try {
    const res = await apiFetch(`/api/schedules/${encodeURIComponent(task.id)}/board`);
    const data = await readApiJson(res);
    if (!res.ok) throw new Error(data.error || 'Не удалось открыть график');
    showBoard(data);
  } catch (err) {
    setScheduleStatus(err.message || 'Не удалось открыть график', { error: true });
  }
}

function showBoard(data) {
  const d = dom();
  state.scheduleBoard = data;
  d.scheduleEditor.hidden = true;
  if (!data.hasSchedule || !data.items?.length) {
    setScheduleStatus('');
    d.scheduleEmpty.hidden = false;
    d.scheduleBoardWrap.hidden = true;
    d.scheduleExportBtn.hidden = true;
    d.scheduleEditBtn.hidden = true;
    return;
  }
  d.scheduleEmpty.hidden = true;
  d.scheduleBoardWrap.hidden = false;
  d.scheduleExportBtn.hidden = false;
  d.scheduleEditBtn.hidden = false;
  if (data.factsBuilding) {
    setScheduleStatus('План на экране. Подтягиваем факт из отчётов…', { loading: true });
    scheduleFactsRefresh(data);
  } else {
    setScheduleStatus('');
  }
  renderBoard(data);
  if (!state.scheduleResizeBound) {
    state.scheduleResizeBound = true;
    let timer = null;
    let lastWidth = window.innerWidth;
    // Mobile browsers fire resize when the address bar hides on scroll; re-rendering
    // then resets the scroll position, so only react to real width changes.
    window.addEventListener('resize', () => {
      if (window.innerWidth === lastWidth) return;
      lastWidth = window.innerWidth;
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (state.scheduleBoard?.hasSchedule && !d.scheduleBoardWrap.hidden) {
          renderBoard(state.scheduleBoard);
        }
      }, 150);
    });
  }
}

function renderBoard(data) {
  const { scheduleBoard } = dom();
  const days = data.days || [];
  const today = todayLocal();
  const reportDates = new Set(data.reportDates || []);
  const mobile = window.matchMedia('(max-width: 720px)').matches;
  scheduleBoard.innerHTML = '';
  const board = mobile
    ? renderMobileBoard(data.items || [], days, reportDates, today)
    : renderDesktopBoard(data.items || [], days, reportDates, today);
  scheduleBoard.append(board);
  syncDayRowOffset(board);
}

function syncDayRowOffset(board) {
  const table = board.matches('table') ? board : board.querySelector('table');
  const monthCell = table?.querySelector('th.gantt-month');
  if (!monthCell) return;
  const height = Math.floor(monthCell.getBoundingClientRect().height);
  if (height > 0) table.style.setProperty('--gantt-day-top', `${height}px`);
}

function monthSpans(days) {
  const months = [];
  for (const day of days) {
    const last = months.at(-1);
    if (!last || last.monthKey !== day.monthKey) {
      months.push({ ...day, count: 1 });
    } else {
      last.count += 1;
    }
  }
  return months;
}

function renderDesktopBoard(items, days, reportDates, today) {
  const table = document.createElement('table');
  table.className = 'gantt gantt--desktop';
  const colgroup = document.createElement('colgroup');
  for (const width of [40, 220, 52, 68, 56]) {
    const col = document.createElement('col');
    col.style.width = `${width}px`;
    colgroup.append(col);
  }
  for (let i = 0; i < days.length; i += 1) {
    const col = document.createElement('col');
    col.style.width = '32px';
    colgroup.append(col);
  }
  table.append(colgroup);
  table.style.tableLayout = 'fixed';
  table.style.width = `${40 + 220 + 52 + 68 + 56 + days.length * 32}px`;

  const thead = document.createElement('thead');
  const monthRow = document.createElement('tr');
  const dayRow = document.createElement('tr');
  for (const label of ['№', 'Наименование', 'Ед.', 'Объём', '']) {
    const th = document.createElement('th');
    th.textContent = label;
    th.rowSpan = 2;
    th.className = 'gantt-sticky';
    monthRow.append(th);
  }
  for (const month of monthSpans(days)) {
    const th = document.createElement('th');
    th.colSpan = month.count;
    th.textContent = month.monthLabel;
    th.className = 'gantt-month';
    monthRow.append(th);
  }
  for (const day of days) {
    const th = document.createElement('th');
    th.className = `gantt-day${day.weekend ? ' is-weekend' : ''}${day.date === today ? ' is-today' : ''}`;
    th.innerHTML = `<span>${day.day}</span><small>${day.weekday}</small>`;
    dayRow.append(th);
  }
  thead.append(monthRow, dayRow);

  const tbody = document.createElement('tbody');
  for (const item of items) {
    const planSet = new Set(item.plan || []);
    tbody.append(itemRows(item, days, planSet, reportDates, 'plan'));
    tbody.append(itemRows(item, days, planSet, reportDates, 'fact'));
  }
  table.append(thead, tbody);
  return table;
}

function renderMobileBoard(items, days, reportDates, today) {
  const INFO_W = 132;
  const KIND_W = 34;
  const DAY_W = 30;
  const table = document.createElement('table');
  table.className = 'gantt gantt--mobile-unified';
  const colgroup = document.createElement('colgroup');
  for (const width of [INFO_W, KIND_W]) {
    const col = document.createElement('col');
    col.style.width = `${width}px`;
    colgroup.append(col);
  }
  for (let i = 0; i < days.length; i += 1) {
    const col = document.createElement('col');
    col.style.width = `${DAY_W}px`;
    colgroup.append(col);
  }
  table.append(colgroup);
  table.style.tableLayout = 'fixed';
  table.style.width = `${INFO_W + KIND_W + days.length * DAY_W}px`;

  const thead = document.createElement('thead');
  const monthRow = document.createElement('tr');
  const dayRow = document.createElement('tr');

  const infoHead = document.createElement('th');
  infoHead.className = 'gantt-sticky gantt-mobile-info';
  infoHead.rowSpan = 2;
  infoHead.textContent = 'Вид работ';
  monthRow.append(infoHead);

  const kindHead = document.createElement('th');
  kindHead.className = 'gantt-sticky gantt-kind';
  kindHead.rowSpan = 2;
  kindHead.textContent = '';
  monthRow.append(kindHead);

  for (const month of monthSpans(days)) {
    const th = document.createElement('th');
    th.colSpan = month.count;
    th.textContent = month.monthLabel;
    th.className = 'gantt-month';
    monthRow.append(th);
  }
  for (const day of days) {
    const th = document.createElement('th');
    th.className = `gantt-day${day.weekend ? ' is-weekend' : ''}${day.date === today ? ' is-today' : ''}`;
    th.innerHTML = `<span>${day.day}</span><small>${day.weekday}</small>`;
    th.title = formatDateRu(day.date);
    dayRow.append(th);
  }
  thead.append(monthRow, dayRow);

  const tbody = document.createElement('tbody');
  for (const item of items) {
    const planSet = new Set(item.plan || []);
    tbody.append(mobileUnifiedRows(item, days, planSet, reportDates, 'plan'));
    tbody.append(mobileUnifiedRows(item, days, planSet, reportDates, 'fact'));
  }
  table.append(thead, tbody);

  const wrap = document.createElement('div');
  wrap.className = 'gantt-mobile-unified-wrap';
  wrap.append(table);
  return wrap;
}

function mobileUnifiedRows(item, days, planSet, reportDates, kind) {
  const tr = document.createElement('tr');
  tr.className = kind === 'plan' ? 'gantt-plan' : 'gantt-fact';

  if (kind === 'plan') {
    const info = document.createElement('td');
    info.rowSpan = 2;
    info.className = 'gantt-sticky gantt-mobile-info';
    info.innerHTML = `
      <div class="gantt-mobile-info-title"></div>
      <div class="gantt-mobile-info-meta"></div>
    `;
    info.querySelector('.gantt-mobile-info-title').textContent = `${item.number}. ${item.name}`;
    info.querySelector('.gantt-mobile-info-meta').textContent =
      `${item.unit} · пл ${formatVolume(item.volumePlan) || '0'} / ф ${formatVolume(item.volumeFact) || '0'}`;
    tr.append(info);
  }

  const label = document.createElement('td');
  label.className = 'gantt-sticky gantt-kind';
  label.textContent = kind === 'plan' ? 'П' : 'Ф';
  tr.append(label);

  appendDayCells(tr, item, days, planSet, reportDates, kind);
  return tr;
}

function appendDayCells(tr, item, days, planSet, reportDates, kind) {
  const today = todayLocal();
  const planWeekendSet = new Set(item.planWeekend || []);
  for (const day of days) {
    const td = document.createElement('td');
    let fillClass = '';
    if (kind === 'plan') {
      if (planSet.has(day.date)) fillClass = 'is-plan';
      else if (planWeekendSet.has(day.date)) fillClass = 'is-plan-weekend';
    } else if (item.fact?.[day.date] != null) {
      fillClass = 'is-fact';
    }
    td.className = [
      'gantt-cell',
      day.weekend ? 'is-weekend' : '',
      day.date === today ? 'is-today' : '',
      fillClass,
    ]
      .filter(Boolean)
      .join(' ');
    const hasFact = kind === 'fact' && item.fact?.[day.date] != null && reportDates.has(day.date);
    if (hasFact) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'gantt-hit';
      btn.setAttribute('aria-label', `Факт ${item.name}, ${formatDateRu(day.date)}`);
      btn.addEventListener('click', () => openDayReport(item, day.date));
      td.append(btn);
    }
    tr.append(td);
  }
}

function itemRows(item, days, planSet, reportDates, kind) {
  const tr = document.createElement('tr');
  tr.className = kind === 'plan' ? 'gantt-plan' : 'gantt-fact';
  if (kind === 'plan') {
    for (const [text, className] of [
      [String(item.number), 'gantt-num'],
      [item.name, 'gantt-name'],
      [item.unit, 'gantt-unit'],
    ]) {
      const td = document.createElement('td');
      td.rowSpan = 2;
      td.className = `gantt-sticky ${className}`;
      td.textContent = text;
      tr.append(td);
    }
  }
  const volume = document.createElement('td');
  volume.className = 'gantt-sticky gantt-volume';
  volume.textContent = formatVolume(kind === 'plan' ? item.volumePlan : item.volumeFact) || '0';
  const label = document.createElement('td');
  label.className = 'gantt-sticky gantt-kind';
  label.textContent = kind === 'plan' ? 'план' : 'факт';
  tr.append(volume, label);

  appendDayCells(tr, item, days, planSet, reportDates, kind);
  return tr;
}

async function openDayReport(item, date) {
  const d = dom();
  const task = state.currentTask;
  d.scheduleDialogDate.textContent = `${formatDateRu(date)} · ${item.name}`;
  d.scheduleDialogVolumes.textContent = 'Загрузка отчёта…';
  d.scheduleDialogBody.textContent = '';
  d.scheduleDialog.showModal();
  try {
    const res = await apiFetch(
      `/api/reports/${encodeURIComponent(task.id)}/${encodeURIComponent(date)}`
    );
    const data = await res.json().catch(() => ({}));
    if (res.status === 404) {
      d.scheduleDialogVolumes.textContent = 'За этот день отчёт ещё не сохранён.';
      d.scheduleDialogBody.textContent = '';
      return;
    }
    if (!res.ok) throw new Error(data.error || 'Не удалось открыть отчёт');
    const parsed = parseReportContent(data.content || '');
    const lines = (parsed.workItems || []).map(
      (row) => `${row.name} — ${formatVolume(row.volume)} ${row.unit}`
    );
    const own = (parsed.workItems || []).find((row) => row.itemId === item.id);
    const head = own
      ? `По этому пункту: ${formatVolume(own.volume)} ${own.unit}`
      : 'В этот день пункт в отчёте не отмечен.';
    d.scheduleDialogVolumes.textContent = lines.length ? `${head}\n${lines.join('\n')}` : head;
    d.scheduleDialogBody.textContent = data.content || '';
  } catch (err) {
    d.scheduleDialogVolumes.textContent = err.message || 'Не удалось открыть отчёт';
  }
}

function renderEditor() {
  const { scheduleEditorRows } = dom();
  const head = document.getElementById('schedule-editor-head');
  if (head) head.hidden = false;
  scheduleEditorRows.innerHTML = '';
  editorItems.forEach((item, index) => {
    const row = document.createElement('div');
    row.className = 'schedule-edit-row';
    row.innerHTML = `
      <span class="schedule-edit-num"></span>
      <input type="text" data-field="name" placeholder="Вид работ" />
      <input type="text" data-field="unit" placeholder="Ед. изм." />
      <input type="number" min="0" step="any" data-field="volumePlan" placeholder="Объём" />
      <label class="schedule-edit-date">
        <span>Начало</span>
        <input type="date" data-field="start" />
      </label>
      <label class="schedule-edit-date">
        <span>Окончание</span>
        <input type="date" data-field="end" />
      </label>
      <button type="button" class="ghost compact" data-remove>Убрать</button>
    `;
    row.querySelector('.schedule-edit-num').textContent = String(index + 1);
    for (const field of ['name', 'unit', 'volumePlan', 'start', 'end']) {
      const input = row.querySelector(`[data-field="${field}"]`);
      input.value = item[field] ?? '';
      input.addEventListener('input', () => {
        item[field] = input.value;
      });
    }
    row.querySelector('[data-remove]').addEventListener('click', () => {
      editorItems.splice(index, 1);
      if (!editorItems.length) editorItems.push(newItem());
      renderEditor();
    });
    scheduleEditorRows.append(row);
  });
}

export function startScheduleEditor(fromBoard = false) {
  const d = dom();
  const source = fromBoard ? state.scheduleBoard?.items || [] : [];
  editorItems = (source.length ? source : [newItem()]).map((item) => ({
    id: item.id || crypto.randomUUID(),
    name: item.name || '',
    unit: item.unit || '',
    volumePlan: item.volumePlan ?? '',
    start: item.start || '',
    end: item.end || '',
  }));
  d.scheduleEmpty.hidden = true;
  d.scheduleBoardWrap.hidden = true;
  d.scheduleExportBtn.hidden = true;
  d.scheduleEditBtn.hidden = true;
  setScheduleStatus('');
  d.scheduleEditor.hidden = false;
  d.scheduleEditorError.hidden = true;
  renderEditor();
}

export function addScheduleRow() {
  editorItems.push(newItem());
  renderEditor();
}

export async function saveScheduleEditor() {
  const d = dom();
  const task = state.currentTask;
  if (!task) return;
  d.scheduleEditorError.hidden = true;
  d.scheduleSaveBtn.disabled = true;
  try {
    const res = await apiFetch(`/api/schedules/${encodeURIComponent(task.id)}`, {
      method: 'PUT',
      body: JSON.stringify({
        items: editorItems.map((item) => ({
          ...item,
          volumePlan: String(item.volumePlan).replace(',', '.'),
        })),
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Не удалось сохранить график');
    showBoard(data);
  } catch (err) {
    d.scheduleEditorError.hidden = false;
    d.scheduleEditorError.textContent = err.message || 'Не удалось сохранить график';
  } finally {
    d.scheduleSaveBtn.disabled = false;
  }
}

export async function deleteSchedule() {
  const task = state.currentTask;
  if (!task) return;
  const ok = window.confirm('Удалить график этого объекта? Отчёты на Диске останутся.');
  if (!ok) return;
  const res = await apiFetch(`/api/schedules/${encodeURIComponent(task.id)}`, {
    method: 'PUT',
    body: JSON.stringify({ items: [] }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    dom().scheduleEditorError.hidden = false;
    dom().scheduleEditorError.textContent = data.error || 'Не удалось удалить график';
    return;
  }
  showBoard({ hasSchedule: false, items: [], days: [] });
}

export function closeScheduleEditor() {
  if (state.scheduleBoard?.hasSchedule) showBoard(state.scheduleBoard);
  else showBoard({ hasSchedule: false, items: [] });
}

export async function exportSchedule() {
  const task = state.currentTask;
  if (!task) return;
  const btn = dom().scheduleExportBtn;
  btn.disabled = true;
  try {
    const res = await apiFetch(`/api/schedules/${encodeURIComponent(task.id)}/export`);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Не удалось скачать Excel');
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `grafik-${task.id}.xlsx`;
    link.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    window.alert(err.message || 'Не удалось скачать Excel');
  } finally {
    btn.disabled = false;
  }
}

export function closeScheduleDialog() {
  dom().scheduleDialog.close();
}
