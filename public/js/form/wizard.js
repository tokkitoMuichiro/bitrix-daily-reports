import { TOTAL_STEPS, STEP_TITLES } from '../constants.js';
import { state } from '../state.js';
import { dom } from '../dom.js';
import { scheduleCatalog, workItemsError } from './work-items.js';

export function updateSubmitLabel() {
  const { submitBtn } = dom();
  submitBtn.textContent = state.editingReport ? 'Сохранить изменения' : 'Сохранить на Диск';
}

export function setFormStep(step) {
  const d = dom();
  state.formStep = Math.min(TOTAL_STEPS, Math.max(1, step));
  document.querySelectorAll('.form-step').forEach((el) => {
    const n = Number(el.dataset.step);
    const active = n === state.formStep;
    el.hidden = !active;
    el.classList.toggle('is-active', active);
  });

  d.wizardFill.style.width = `${(state.formStep / TOTAL_STEPS) * 100}%`;
  d.wizardLabel.textContent = `Шаг ${state.formStep} из ${TOTAL_STEPS} — ${STEP_TITLES[state.formStep - 1]}`;

  d.stepPrevBtn.hidden = state.formStep === 1;
  d.stepNextBtn.hidden = state.formStep === TOTAL_STEPS;
  d.submitBtn.hidden = state.formStep !== TOTAL_STEPS;
  d.formError.hidden = true;
  updateSubmitLabel();
}

export function validateStep(step) {
  const requiredByStep = {
    1: ['date', 'work-start-from', 'work-start-to', 'estimated-completion'],
    2: ['staff-itr', 'staff-foremen', 'staff-workers', 'work-stage'],
    3: scheduleCatalog().length ? ['tech-means'] : ['tech-means', 'volumes'],
    4: ['next-day'],
  };

  for (const id of requiredByStep[step] || []) {
    const el = document.getElementById(id);
    if (!el || !String(el.value || '').trim()) {
      el?.focus();
      return `Заполните обязательные поля шага «${STEP_TITLES[step - 1]}»`;
    }
  }
  if (step === 3) return workItemsError();
  return null;
}
