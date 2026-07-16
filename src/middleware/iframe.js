/** Разрешаем открытие формы внутри Битрикс (iframe). */
export function bitrixFrameHeaders(_req, res, next) {
  res.removeHeader('X-Frame-Options');
  res.setHeader(
    'Content-Security-Policy',
    "frame-ancestors 'self' https://*.bitrix24.ru https://*.bitrix24.com https://*.bitrix24.by https://*.bitrix24.kz https://*.bitrix24.ua"
  );
  next();
}
