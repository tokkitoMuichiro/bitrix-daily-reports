import { TOTAL_STEPS } from './constants.js';
import { state } from './state.js';
import { dom } from './dom.js';
import { apiFetch } from './api/client.js';
import { formatDateRu, todayLocal } from './utils/dates.js';
import { setMode, hideAllWorkPanels } from './ui/panels.js';
import { loadTasks, onTaskSearchInput, setTaskSelectHandler } from './tasks/list.js';
import { selectTask, showTaskPicker } from './navigation.js';
import {
  addDronePeriodRow,
  readFormValues,
  setDronePeriods,
} from './form/fields.js';
import { saveDraft, scheduleDraftSave, clearDraft, bindDraftToDroneChanges } from './form/drafts.js';
import { setFormStep, validateStep, updateSubmitLabel } from './form/wizard.js';
import {
  loadDates,
  startEditReport,
  copyYesterdayReport,
  reportExistsForDate,
} from './reports/archive.js';
import { workItemsError } from './form/work-items.js';
import {
  addScheduleRow,
  closeScheduleDialog,
  closeScheduleEditor,
  deleteSchedule,
  exportSchedule,
  saveScheduleEditor,
  startScheduleEditor,
} from './schedules/view.js';

function goMode(next) {
  setMode(next, { loadTasks });
}

async function onSubmitReport(event) {
  event.preventDefault();
  const d = dom();
  d.formError.hidden = true;

  for (let step = 1; step <= TOTAL_STEPS; step += 1) {
    const error = validateStep(step);
    if (error) {
      setFormStep(step);
      d.formError.textContent = error;
      d.formError.hidden = false;
      return;
    }
  }

  const itemsError = workItemsError();
  if (itemsError) {
    setFormStep(3);
    d.formError.textContent = itemsError;
    d.formError.hidden = false;
    return;
  }

  const payload = readFormValues();
  if (!payload.taskId) {
    d.formError.textContent = 'Сначала выберите объект';
    d.formError.hidden = false;
    return;
  }

  try {
    const editingSame =
      state.editingReport &&
      String(state.editingReport.taskId) === String(payload.taskId) &&
      state.editingReport.date === payload.date;

    if (!editingSame) {
      const exists = await reportExistsForDate(payload.taskId, payload.date);
      if (exists) {
        const ok = window.confirm(
          `Отчёт за ${formatDateRu(payload.date)} уже есть на Диске.\nПерезаписать его?`
        );
        if (!ok) return;
      }
    }
  } catch {
    /* если проверка не удалась — всё равно даём сохранить */
  }

  d.submitBtn.disabled = true;
  d.submitBtn.textContent = 'Сохранение…';

  try {
    const res = await apiFetch('/api/reports', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Ошибка сохранения');

    const wasEdit = Boolean(state.editingReport);
    clearDraft(payload.taskId);
    state.editingReport = null;
    state.lastSaved = { taskId: data.taskId, date: data.date, title: data.taskTitle };
    hideAllWorkPanels();
    d.successPanel.hidden = false;
    const where = data.mockMode
      ? 'локально (демо-папка data/mock-disk)'
      : 'на Диске Битрикс';
    d.successText.textContent = wasEdit
      ? `«${data.taskTitle}» за ${formatDateRu(data.date)} — изменения сохранены ${where}.`
      : `«${data.taskTitle}» за ${formatDateRu(data.date)} — сохранено ${where}. В архиве: объект → эта дата.`;

    d.reportForm.reset();
    setDronePeriods([{ from: '', to: '' }]);
    d.dateInput.value = todayLocal();
    d.taskIdInput.value = '';
    setFormStep(1);
    if (state.bitrixUserName) {
      d.authorNameInput.value = state.bitrixUserName;
    }
  } catch (err) {
    saveDraft('offline');
    const msg = String(err.message || '');
    d.formError.textContent =
      msg === 'Failed to fetch' || !navigator.onLine
        ? 'Нет сети. Черновик сохранён на устройстве — откройте объект снова, когда появится связь.'
        : msg || 'Не удалось сохранить отчёт. Черновик сохранён на устройстве.';
    d.formError.hidden = false;
  } finally {
    d.submitBtn.disabled = false;
    updateSubmitLabel();
  }
}

async function onSendDigest() {
  const btn = dom().sendDigestBtn;
  if (btn.disabled) return;
  const ok = window.confirm(
    'Отправить в чат проекта сводку: по каким активным объектам есть отчёт за сегодня, а по каким нет?'
  );
  if (!ok) return;

  btn.disabled = true;
  const prev = btn.textContent;
  btn.textContent = 'Отправка…';
  try {
    const res = await apiFetch('/api/digest/send', { method: 'POST', body: '{}' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Ошибка отправки');
    const where = data.mock ? '(демо, в чат не ушло)' : `в ${data.chatId}`;
    window.alert(
      `Сводка за ${formatDateRu(data.date)} отправлена ${where}.\n` +
        `С отчётом: ${data.withReportCount}\n` +
        `Без отчёта: ${data.withoutReportCount}`
    );
  } catch (err) {
    window.alert(err.message || 'Не удалось отправить статистику');
  } finally {
    btn.disabled = false;
    btn.textContent = prev;
  }
}

/** Один раз при старте: колбэки без циклов + все DOM-слушатели. */
export function wireApp() {
  const d = dom();

  bindDraftToDroneChanges();
  setTaskSelectHandler(selectTask);

  d.stepPrevBtn.addEventListener('click', () => {
    saveDraft('step');
    setFormStep(state.formStep - 1);
  });

  d.stepNextBtn.addEventListener('click', () => {
    const error = validateStep(state.formStep);
    if (error) {
      d.formError.textContent = error;
      d.formError.hidden = false;
      return;
    }
    saveDraft('step');
    setFormStep(state.formStep + 1);
  });

  d.copyYesterdayBtn.addEventListener('click', copyYesterdayReport);

  d.reportForm.addEventListener('input', scheduleDraftSave);
  d.reportForm.addEventListener('change', scheduleDraftSave);

  window.addEventListener('offline', () => {
    if (d.taskIdInput.value && !d.formPanel.hidden) {
      saveDraft('offline');
    }
  });

  d.reportForm.addEventListener('submit', onSubmitReport);

  d.tabCreate.addEventListener('click', () => goMode('create'));
  d.tabArchive.addEventListener('click', () => goMode('archive'));
  d.tabSchedules.addEventListener('click', () => goMode('schedules'));
  d.scheduleChangeTaskBtn.addEventListener('click', showTaskPicker);
  d.scheduleCreateBtn.addEventListener('click', () => startScheduleEditor(false));
  d.scheduleEditBtn.addEventListener('click', () => startScheduleEditor(true));
  d.scheduleAddRowBtn.addEventListener('click', addScheduleRow);
  d.scheduleSaveBtn.addEventListener('click', saveScheduleEditor);
  d.scheduleCancelBtn.addEventListener('click', closeScheduleEditor);
  d.scheduleDeleteBtn.addEventListener('click', deleteSchedule);
  d.scheduleExportBtn.addEventListener('click', exportSchedule);
  d.scheduleDialogClose.addEventListener('click', closeScheduleDialog);
  d.refreshTasksBtn.addEventListener('click', () => loadTasks(true));
  d.sendDigestBtn.addEventListener('click', onSendDigest);
  d.changeTaskBtn.addEventListener('click', showTaskPicker);
  d.archiveChangeTaskBtn.addEventListener('click', showTaskPicker);
  d.backToDatesBtn.addEventListener('click', () => {
    d.reportView.hidden = true;
    state.viewingReport = null;
    if (state.currentTask) loadDates(state.currentTask.id);
  });
  d.editReportBtn.addEventListener('click', startEditReport);
  d.againBtn.addEventListener('click', () => goMode('create'));
  d.gotoArchiveBtn.addEventListener('click', () => {
    goMode('archive');
    if (state.lastSaved) {
      const task = state.tasks.find((t) => t.id === String(state.lastSaved.taskId)) || {
        id: state.lastSaved.taskId,
        title: state.lastSaved.title,
        status: 3,
      };
      selectTask(task);
    }
  });
  d.searchInput.addEventListener('input', onTaskSearchInput);
  d.addDronePeriodBtn.addEventListener('click', () => {
    addDronePeriodRow();
    scheduleDraftSave();
  });
}

export { goMode };
