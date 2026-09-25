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
