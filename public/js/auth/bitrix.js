import { state } from '../state.js';
import { dom } from '../dom.js';
import { apiFetch } from '../api/client.js';
import { loadBx24Auth, startTokenAutoRefresh } from './token.js';

export function showAuthGate(message, detail) {
  const d = dom();
  d.authGate.hidden = false;
  d.appRoot.hidden = true;
  if (message) d.authGateText.textContent = message;
  if (detail) {
    d.authGateError.textContent = detail;
    d.authGateError.hidden = false;
  } else {
    d.authGateError.hidden = true;
  }
}

export function hideAuthGate() {
  const d = dom();
  d.authGate.hidden = true;
  d.appRoot.hidden = false;
}

export async function bootstrapAuth() {
  const d = dom();
  const configRes = await fetch('/api/auth/config');
  const config = await configRes.json();

  const auth = await loadBx24Auth();
  state.bitrixAuth.accessToken = auth.accessToken || '';
  state.bitrixAuth.domain = auth.domain || config.portal || '';

  if (!config.required) {
    hideAuthGate();
    return { user: null, required: false };
  }

  if (!state.bitrixAuth.accessToken) {
    showAuthGate(
      `Откройте «АММИР отчёт» из меню Битрикс24 (${config.portal}). Прямая ссылка в браузере без входа не работает.`,
      'Токен авторизации не получен.'
    );
    return { user: null, required: true, ok: false };
  }

  const meRes = await apiFetch('/api/auth/me');
  const meData = await meRes.json().catch(() => ({}));
  if (!meRes.ok) {
    showAuthGate(
      'Не удалось подтвердить вход в Битрикс. Откройте приложение снова из меню портала.',
      meData.error || `Ошибка ${meRes.status}`
    );
    return { user: null, required: true, ok: false };
  }

  hideAuthGate();
  if (meData.user?.name) {
    state.bitrixUserName = meData.user.name;
    d.userBadge.hidden = false;
    d.userBadge.textContent = `Вы вошли: ${meData.user.name}`;
    if (d.authorNameInput && !d.authorNameInput.value) {
      d.authorNameInput.value = meData.user.name;
    }
  }
  startTokenAutoRefresh();
  return { user: meData.user, required: true, ok: true };
}
