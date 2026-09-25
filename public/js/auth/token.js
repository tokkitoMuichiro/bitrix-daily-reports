import { state } from '../state.js';

/** Обновление AUTH_ID через BX24 (без apiFetch — без циклов). */
export function refreshBitrixToken() {
  return new Promise((resolve) => {
    if (typeof BX24 === 'undefined' || typeof BX24.refreshAuth !== 'function') {
      resolve(false);
      return;
    }

    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      resolve(ok);
    };

    const timer = setTimeout(() => finish(false), 8000);

    try {
      BX24.refreshAuth((auth) => {
        clearTimeout(timer);
        const token = auth?.access_token || BX24.getAuth()?.access_token;
        if (token) {
          state.bitrixAuth.accessToken = token;
          const domain = auth?.domain || BX24.getAuth()?.domain;
          if (domain) state.bitrixAuth.domain = domain;
          finish(true);
          return;
        }
        finish(false);
      });
    } catch {
      clearTimeout(timer);
      finish(false);
    }
  });
}

export function startTokenAutoRefresh() {
  if (state.tokenRefreshTimer) clearInterval(state.tokenRefreshTimer);
  state.tokenRefreshTimer = setInterval(() => {
    refreshBitrixToken().catch(() => {});
  }, 20 * 60 * 1000);
}

export function readAuthFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return {
    accessToken: params.get('AUTH_ID') || params.get('auth') || '',
    domain: params.get('DOMAIN') || params.get('domain') || '',
  };
}

export function loadBx24Auth() {
  return new Promise((resolve) => {
    const fromUrl = readAuthFromUrl();
    if (typeof BX24 === 'undefined') {
      resolve(fromUrl);
      return;
    }

    let done = false;
    const finish = (auth) => {
      if (done) return;
      done = true;
      resolve(auth);
    };

    const timer = setTimeout(() => finish(fromUrl), 2500);

    try {
      BX24.init(() => {
        clearTimeout(timer);
        try {
          if (typeof BX24.installFinish === 'function') {
            BX24.installFinish();
          }
        } catch {
          /* already installed */
        }
        try {
          const auth = BX24.getAuth() || {};
          finish({
            accessToken: auth.access_token || fromUrl.accessToken || '',
            domain: auth.domain || fromUrl.domain || '',
          });
        } catch {
          finish(fromUrl);
        }
      });
    } catch {
      clearTimeout(timer);
      finish(fromUrl);
    }
  });
}
