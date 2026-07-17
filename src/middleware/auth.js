import 'dotenv/config';

/**
 * Авторизация сотрудников через локальное приложение Битрикс24 (AUTH_ID).
 * Прямой заход на сайт без токена — 401 (если REQUIRE_BITRIX_AUTH=1).
 */

const allowedDomain = normalizeDomain(
  process.env.BITRIX_PORTAL_DOMAIN || extractDomainFromWebhook() || 'ammir.bitrix24.ru'
);

/** Кэш проверок AUTH_ID, чтобы не дергать Bitrix на каждый клик */
const authCache = new Map();
const CACHE_TTL_MS = 90_000;

function extractDomainFromWebhook() {
  const url = process.env.BITRIX_WEBHOOK_URL || '';
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

function normalizeDomain(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '');
}

export function isAuthRequired() {
  const flag = process.env.REQUIRE_BITRIX_AUTH;
  if (flag === '0' || flag === 'false') return false;
  if (flag === '1' || flag === 'true') return true;
  // По умолчанию: в демо-режиме не требуем, на боевом — требуем
  const mock =
    process.env.MOCK_BITRIX === '1' ||
    process.env.MOCK_BITRIX === 'true';
  return !mock;
}

export function getAuthConfig() {
  return {
    required: isAuthRequired(),
    portal: allowedDomain,
  };
}

function getCached(authId) {
  const hit = authCache.get(authId);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) {
    authCache.delete(authId);
    return null;
  }
  return hit.user;
}

function setCached(authId, user) {
  authCache.set(authId, { user, expiresAt: Date.now() + CACHE_TTL_MS });
}

function readAuthFromRequest(req) {
  const headerAuth =
    req.get('x-bitrix-auth-id') ||
    req.get('x-bitrix-auth') ||
    '';
  const headerDomain = req.get('x-bitrix-domain') || '';

  const queryAuth = req.query?.AUTH_ID || req.query?.auth || '';
  const queryDomain = req.query?.DOMAIN || req.query?.domain || '';

  const bodyAuth = req.body?.AUTH_ID || req.body?.auth || '';
  const bodyDomain = req.body?.DOMAIN || req.body?.domain || '';

  return {
    authId: String(headerAuth || queryAuth || bodyAuth || '').trim(),
    domain: normalizeDomain(headerDomain || queryDomain || bodyDomain || allowedDomain),
  };
}

function formatUser(raw) {
  const id = String(raw.ID ?? raw.id ?? '');
  const name = [raw.NAME ?? raw.name, raw.LAST_NAME ?? raw.lastName]
    .filter(Boolean)
    .join(' ')
    .trim();
  return {
    id,
    name: name || raw.EMAIL || raw.email || `user-${id}`,
    email: raw.EMAIL || raw.email || null,
    active: raw.ACTIVE !== false && raw.ACTIVE !== 'N',
  };
}

/**
 * Проверка токена: GET https://domain/rest/user.current.json?auth=AUTH_ID
 */
export async function validateBitrixAuth(authId, domain) {
  if (!authId) {
    throw Object.assign(new Error('Нет токена авторизации Битрикс'), { status: 401 });
  }

  const host = normalizeDomain(domain) || allowedDomain;
  if (host !== allowedDomain) {
    throw Object.assign(
      new Error(`Доступ только с портала ${allowedDomain}`),
      { status: 403 }
    );
  }

  const cached = getCached(authId);
  if (cached) return cached;

  const url = `https://${host}/rest/user.current.json?auth=${encodeURIComponent(authId)}`;
  const response = await fetch(url);
  const data = await response.json().catch(() => ({}));

  if (data.error) {
    const msg = data.error_description || data.error || 'Токен недействителен';
    const lower = String(msg).toLowerCase();
    const expired = lower.includes('expired') || lower.includes('expire');
    throw Object.assign(new Error(msg), {
      status: 401,
      code: expired ? 'BITRIX_TOKEN_EXPIRED' : 'BITRIX_AUTH_REQUIRED',
    });
  }

  if (!data.result) {
    throw Object.assign(new Error('Не удалось получить пользователя Битрикс'), { status: 401 });
  }

  const user = formatUser(data.result);
  if (!user.active) {
    throw Object.assign(new Error('Учётная запись Битрикс неактивна'), { status: 403 });
  }

  setCached(authId, user);
  return user;
}

/**
 * Express middleware: пускает только сотрудников портала с валидным AUTH_ID.
 * Не применяется, если REQUIRE_BITRIX_AUTH выключен (локальная разработка).
 */
export async function requireBitrixAuth(req, res, next) {
  if (!isAuthRequired()) {
    req.bitrixUser = null;
    return next();
  }

  try {
    const { authId, domain } = readAuthFromRequest(req);
    req.bitrixUser = await validateBitrixAuth(authId, domain);
    req.bitrixAuthId = authId;
    return next();
  } catch (error) {
    const status = error.status || 401;
    return res.status(status).json({
      error: error.message || 'Требуется вход через Битрикс24',
      code: error.code || 'BITRIX_AUTH_REQUIRED',
      portal: allowedDomain,
    });
  }
}
