import { state } from '../state.js';
import { dom } from '../dom.js';
import { apiFetch } from '../api/client.js';
import { formatDateRu, todayLocal, shiftDate } from '../utils/dates.js';
import { hideAllWorkPanels } from '../ui/panels.js';
import { fillFormFields } from '../form/fields.js';
import { saveDraft } from '../form/drafts.js';
import { setFormStep } from '../form/wizard.js';
import { parseReportContent } from './parse.js';
import { refreshWorkItemCatalog } from '../form/work-items.js';

function setDatesStatus(message, { loading = false, error = false } = {}) {
  const el = dom().datesStatusEl;
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

export async function loadDates(taskId) {
  const { dateListEl, reportView } = dom();
  dateListEl.hidden = true;
  dateListEl.innerHTML = '';
  reportView.hidden = true;
  setDatesStatus('Загрузка отчётов…', { loading: true });

  try {
    const res = await apiFetch(`/api/reports/${encodeURIComponent(taskId)}/dates`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Ошибка');

    const dates = data.dates || [];
    if (!dates.length) {
      setDatesStatus('По этому объекту отчётов пока нет');
      return;
    }

    setDatesStatus('');
    dateListEl.hidden = false;
    const frag = document.createDocumentFragment();
    for (const date of dates) {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      const title = document.createElement('span');
      title.className = 'task-title';
      title.textContent = formatDateRu(date);
      const meta = document.createElement('span');
      meta.className = 'task-meta';
      meta.textContent = date;
      btn.append(title, meta);
      btn.addEventListener('click', () => openReport(taskId, date));
      li.append(btn);
      frag.append(li);
    }
    dateListEl.append(frag);
  } catch (err) {
    setDatesStatus(err.message || 'Не удалось загрузить даты', { error: true });
  }
}

export async function openReport(taskId, date) {
  const { dateListEl, reportView, reportViewDate, reportContent } = dom();
  setDatesStatus('');
  try {
    const res = await apiFetch(
      `/api/reports/${encodeURIComponent(taskId)}/${encodeURIComponent(date)}`
    );
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Ошибка чтения');

    state.viewingReport = { taskId: String(taskId), date, content: data.content || '' };
    dateListEl.hidden = true;
    reportView.hidden = false;
    reportViewDate.textContent = `Отчёт за ${formatDateRu(date)}`;
    reportContent.textContent = data.content || '';
  } catch (err) {
    state.viewingReport = null;
    setDatesStatus(err.message || 'Не удалось открыть отчёт', { error: true });
  }
}

/** Переход в форму редактирования без setMode (чтобы не сбросить editingReport). */
export async function startEditReport() {
  if (!state.viewingReport || !state.currentTask) return;

  const d = dom();
  const { taskId, date, content } = state.viewingReport;
  const parsed = parseReportContent(content);

  state.mode = 'create';
  d.tabCreate.classList.add('is-active');
  d.tabArchive.classList.remove('is-active');
  d.tabSchedules.classList.remove('is-active');
  d.modeHint.textContent = `Редактирование отчёта за ${formatDateRu(date)}. После сохранения файл на Диске обновится.`;

  state.editingReport = { taskId: String(taskId), date };
  d.taskIdInput.value = taskId;
  d.selectedTitle.textContent = `${state.currentTask.title} (#${taskId})`;

  hideAllWorkPanels();
  d.formPanel.hidden = false;
  d.formError.hidden = true;

  await refreshWorkItemCatalog(taskId);
  fillFormFields(parsed, { keepDate: false, keepAuthor: false });
  d.dateInput.value = date;
  if (state.bitrixUserName && !d.authorNameInput.value) {
    d.authorNameInput.value = state.bitrixUserName;
  }

  setFormStep(1);
  d.draftHint.hidden = false;
  d.draftHint.textContent = `Редактирование отчёта за ${formatDateRu(date)}`;
  d.workStartFromInput.focus();
}

export async function copyYesterdayReport() {
  const d = dom();
  const taskId = d.taskIdInput.value;
  if (!taskId) return;

  d.copyYesterdayBtn.disabled = true;
  d.copyYesterdayBtn.textContent = 'Загрузка…';
  d.formError.hidden = true;

  try {
    const datesRes = await apiFetch(`/api/reports/${encodeURIComponent(taskId)}/dates`);
    const datesData = await datesRes.json();
    if (!datesRes.ok) throw new Error(datesData.error || 'Не удалось получить даты');

    const dates = datesData.dates || [];
    const today = d.dateInput.value || todayLocal();
    const yesterday = shiftDate(today, -1);
    const sourceDate =
      dates.find((item) => item === yesterday) || dates.find((item) => item < today) || dates[0];

    if (!sourceDate) {
      throw new Error('По этому объекту ещё нет сохранённых отчётов');
    }

    const res = await apiFetch(
      `/api/reports/${encodeURIComponent(taskId)}/${encodeURIComponent(sourceDate)}`
    );
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Не удалось прочитать отчёт');

    const parsed = parseReportContent(data.content);
    fillFormFields(parsed, { keepDate: true, keepAuthor: true });
    d.dateInput.value = today;
    saveDraft('copy');
    setFormStep(1);
    d.draftHint.hidden = false;
    d.draftHint.textContent = `Скопирован отчёт за ${formatDateRu(sourceDate)}. Проверьте поля и дату.`;
  } catch (err) {
    d.formError.textContent = err.message || 'Не удалось скопировать отчёт';
    d.formError.hidden = false;
  } finally {
    d.copyYesterdayBtn.disabled = false;
    d.copyYesterdayBtn.textContent = 'Копировать вчерашний';
  }
}

export async function reportExistsForDate(taskId, date) {
  const res = await apiFetch(`/api/reports/${encodeURIComponent(taskId)}/dates`);
  const data = await res.json();
  if (!res.ok) return false;
  return (data.dates || []).includes(date);
}
