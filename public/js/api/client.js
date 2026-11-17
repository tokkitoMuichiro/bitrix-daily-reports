import { state } from '../state.js';
import { refreshBitrixToken } from '../auth/token.js';

/**
 * fetch с заголовками AUTH_ID; при 401 — одно обновление токена и повтор.
 */
export async function apiFetch(url, options = {}, retried = false) {
  const headers = new Headers(options.headers || {});
  if (state.bitrixAuth.accessToken) {
    headers.set('X-Bitrix-Auth-Id', state.bitrixAuth.accessToken);
  }
  if (state.bitrixAuth.domain) {
    headers.set('X-Bitrix-Domain', state.bitrixAuth.domain);
  }
  if (options.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(url, { ...options, headers });

  if (res.status === 401 && !retried) {
    const data = await res.clone().json().catch(() => ({}));
    const blob = `${data.error || ''} ${data.code || ''}`.toLowerCase();
    const looksExpired =
      blob.includes('expired') ||
      data.code === 'BITRIX_TOKEN_EXPIRED' ||
      data.code === 'BITRIX_AUTH_REQUIRED';

    if (looksExpired) {
      const refreshed = await refreshBitrixToken();
      if (refreshed) {
        return apiFetch(url, options, true);
      }
    }
  }

  return res;
}

/** Безопасный разбор JSON: nginx/прокси иногда отдают HTML при таймауте. */
export async function readApiJson(res) {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    const looksHtml = /^\s*</.test(text) || text.includes('<html');
    if (res.status === 504 || res.status === 502 || looksHtml) {
      throw new Error(
        'Сервер не успел ответить (таймаут). Обновите страницу — повторная загрузка графика обычно быстрее.'
      );
    }
    throw new Error(`Некорректный ответ сервера (${res.status || 'ошибка'})`);
  }
}
