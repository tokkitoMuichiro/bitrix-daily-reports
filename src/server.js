import express from 'express';
import path from 'path';
import { port, publicDir } from './config.js';
import { bitrixFrameHeaders } from './middleware/iframe.js';
import apiRouter from './routes/api.js';

const app = express();

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// Форма открывается в iframe Битрикс (левое меню)
app.use(bitrixFrameHeaders);

app.use('/api', apiRouter);

/**
 * Битрикс при установке/открытии шлёт POST на URL обработчика.
 * express.static умеет только GET.
 */
const indexPage = path.join(publicDir, 'index.html');
const installPage = path.join(publicDir, 'install.html');

app.post('/', (_req, res) => {
  res.sendFile(indexPage);
});
app.all('/install.html', (_req, res) => {
  res.sendFile(installPage);
});
app.all('/install', (_req, res) => {
  res.sendFile(installPage);
});

app.use(express.static(publicDir));

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.listen(port, () => {
  console.log(`Отчёты Битрикс: http://localhost:${port}`);
});
