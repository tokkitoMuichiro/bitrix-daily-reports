import { DRAFT_PREFIX } from '../constants.js';
import { state } from '../state.js';
import { dom } from '../dom.js';
import { readFormValues, setDroneChangeHandler } from './fields.js';

export function draftKey(taskId) {
  return `${DRAFT_PREFIX}${taskId}`;
}

export function saveDraft(reason = '') {
  const { taskIdInput, draftHint } = dom();
  const taskId = taskIdInput.value;
  if (!taskId) return;

  const payload = {
    ...readFormValues(),
    step: state.formStep,
    savedAt: new Date().toISOString(),
    reason,
  };

  try {
    localStorage.setItem(draftKey(taskId), JSON.stringify(payload));
    draftHint.hidden = false;
    draftHint.textContent =
      reason === 'offline'
        ? 'Черновик сохранён на устройстве (нет сети). Можно продолжить позже.'
        : 'Черновик сохранён на устройстве';
  } catch {
    /* quota / private mode */
  }
}

export function loadDraft(taskId) {
  try {
    const raw = localStorage.getItem(draftKey(taskId));
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function clearDraft(taskId) {
  const { taskIdInput, draftHint } = dom();
  try {
    localStorage.removeItem(draftKey(taskId || taskIdInput.value));
  } catch {
    /* ignore */
  }
  draftHint.hidden = true;
}

export function scheduleDraftSave() {
  clearTimeout(state.draftTimer);
  state.draftTimer = setTimeout(() => saveDraft('autosave'), 400);
}

/** Связать удаление периодов БПЛА с автосохранением черновика. */
export function bindDraftToDroneChanges() {
  setDroneChangeHandler(scheduleDraftSave);
}
