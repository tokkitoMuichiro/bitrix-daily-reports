/**
 * Точка входа UI «АММИР отчёт».
 * Логика разнесена по модулям: auth, tasks, form, reports, api.
 */
import { dom } from './dom.js';
import { todayLocal } from './utils/dates.js';
import { setDronePeriods } from './form/fields.js';
import { setFormStep } from './form/wizard.js';
import { bootstrapAuth, showAuthGate } from './auth/bitrix.js';
import { wireApp, goMode } from './events.js';

wireApp();

dom().dateInput.value = todayLocal();
setDronePeriods([{ from: '', to: '' }]);
setFormStep(1);

(async function start() {
  try {
    const session = await bootstrapAuth();
    if (session.required && session.ok === false) return;
    goMode('create');
  } catch (err) {
    showAuthGate(
      'Не удалось инициализировать вход. Откройте приложение из Битрикс24.',
      err.message || String(err)
    );
  }
})();
