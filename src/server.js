import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import apiRouter from './routes/api.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const port = Number(process.env.PORT) || 3000;

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// Разрешаем открытие формы внутри Битрикс (кнопка в левом меню → iframe)
app.use((_req, res, next) => {
  res.removeHeader('X-Frame-Options');
  res.setHeader(
    'Content-Security-Policy',
    "frame-ancestors 'self' https://*.bitrix24.ru https://*.bitrix24.com https://*.bitrix24.by https://*.bitrix24.kz https://*.bitrix24.ua"
  );
  next();
});

app.use('/api', apiRouter);
app.use(express.static(path.join(__dirname, '../public')));

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.listen(port, () => {
  console.log(`Отчёты Битрикс: http://localhost:${port}`);
});
