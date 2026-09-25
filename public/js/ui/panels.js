import { state } from '../state.js';
import { dom } from '../dom.js';

export function hideAllWorkPanels() {
  const d = dom();
  d.taskPanel.hidden = true;
  d.formPanel.hidden = true;
  d.archivePanel.hidden = true;
  d.schedulePanel.hidden = true;
  d.successPanel.hidden = true;
  document.querySelector('.page')?.classList.remove('page--wide');
}

export function setMode(next, { loadTasks } = {}) {
  const d = dom();
  state.mode = next;
  state.editingReport = null;
  state.viewingReport = null;
  d.tabCreate.classList.toggle('is-active', state.mode === 'create');
  d.tabArchive.classList.toggle('is-active', state.mode === 'archive');
  d.tabSchedules.classList.toggle('is-active', state.mode === 'schedules');
  d.modeHint.textContent =
    state.mode === 'create'
      ? 'Выберите объект, заполните отчёт по шагам и сохраните на Диск.'
      : state.mode === 'schedules'
        ? 'Выберите объект: откроется график или пометка, что его ещё нет.'
        : 'Только объекты с сохранёнными отчётами — в том числе завершённые задачи.';
  d.taskPanelTitle.textContent =
    state.mode === 'archive'
      ? 'Архив: объекты с отчётами'
      : state.mode === 'schedules'
        ? 'Графики по объектам'
        : 'Объекты (задачи)';

  state.currentTask = null;
  hideAllWorkPanels();
  d.taskPanel.hidden = false;
  if (typeof loadTasks === 'function') {
    loadTasks(true);
  }
}
