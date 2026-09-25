import { state } from './state.js';
import { dom } from './dom.js';
import { todayLocal } from './utils/dates.js';
import { hideAllWorkPanels } from './ui/panels.js';
import { setDronePeriods, fillFormFields } from './form/fields.js';
import { loadDraft, saveDraft } from './form/drafts.js';
import { setFormStep } from './form/wizard.js';
import { loadDates } from './reports/archive.js';
import { refreshWorkItemCatalog } from './form/work-items.js';
import { openSchedule } from './schedules/view.js';

export async function selectTask(task) {
  const d = dom();
  state.currentTask = task;
  if (state.mode === 'create') {
    state.editingReport = null;
    d.taskIdInput.value = task.id;
    d.selectedTitle.textContent = `${task.title} (#${task.id})`;
    hideAllWorkPanels();
    d.formPanel.hidden = false;
    d.formError.hidden = true;

    d.reportForm.reset();
    setDronePeriods([{ from: '', to: '' }]);
    d.dateInput.value = todayLocal();
    if (state.bitrixUserName) {
      d.authorNameInput.value = state.bitrixUserName;
    }

    await refreshWorkItemCatalog(task.id);

    const draft = loadDraft(task.id);
    if (draft) {
      const when = draft.savedAt
        ? new Date(draft.savedAt).toLocaleString('ru-RU', {
            day: '2-digit',
            month: 'short',
            hour: '2-digit',
            minute: '2-digit',
          })
        : '';
      const restore = window.confirm(
        `Найден черновик${when ? ` от ${when}` : ''}. Восстановить?`
      );
      if (restore) {
        fillFormFields(draft, { keepDate: false, keepAuthor: false });
        if (draft.date) d.dateInput.value = draft.date;
        setFormStep(Number(draft.step) || 1);
        d.draftHint.hidden = false;
        d.draftHint.textContent = 'Восстановлен черновик с устройства';
      } else {
        setFormStep(1);
        d.draftHint.hidden = true;
      }
    } else {
      setFormStep(1);
      d.draftHint.hidden = true;
    }

    d.workStartFromInput.focus();
    return;
  }

  if (state.mode === 'schedules') {
    await openSchedule(task);
    return;
  }

  d.archiveTitle.textContent = `${task.title} (#${task.id})`;
  hideAllWorkPanels();
  d.archivePanel.hidden = false;
  d.reportView.hidden = true;
  loadDates(task.id);
}

export function showTaskPicker() {
  const { taskPanel } = dom();
  saveDraft('leave');
  hideAllWorkPanels();
  taskPanel.hidden = false;
}
