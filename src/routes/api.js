import { Router } from 'express';
import {
  listActiveTasksPage,
  getTask,
  saveReport,
  listReportDates,
  getReportFromDisk,
  mockMode,
} from '../services/bitrix.js';
import { getAuthConfig, requireBitrixAuth } from '../middleware/auth.js';

const router = Router();

/** Публично: нужна ли авторизация (для экрана «откройте через Битрикс») */
router.get('/auth/config', (_req, res) => {
  res.json(getAuthConfig());
});

/** Кто вошёл (проверка AUTH_ID) */
router.get('/auth/me', requireBitrixAuth, (req, res) => {
  res.json({
    user: req.bitrixUser,
    authRequired: getAuthConfig().required,
  });
});

router.get('/status', requireBitrixAuth, (_req, res) => {
  res.json({
    mockMode,
    storage: mockMode ? 'local:data/mock-disk' : 'bitrix-disk',
    auth: getAuthConfig(),
  });
});

router.get('/tasks', requireBitrixAuth, async (req, res) => {
  try {
    const query = String(req.query.q || req.query.search || '').trim();
    const start = Math.max(0, Number(req.query.start) || 0);
    const limit = Math.min(50, Math.max(10, Number(req.query.limit) || 30));

    const page = await listActiveTasksPage({ query, start, limit });
    res.json(page);
  } catch (error) {
    console.error(error);
    res.status(502).json({ error: error.message || 'Не удалось загрузить задачи' });
  }
});

router.get('/tasks/:id', requireBitrixAuth, async (req, res) => {
  try {
    const task = await getTask(req.params.id);
    res.json({ task });
  } catch (error) {
    console.error(error);
    res.status(502).json({ error: error.message || 'Не удалось загрузить задачу' });
  }
});

/** Список дат, по которым есть отчёты для объекта (задачи) */
router.get('/reports/:taskId/dates', requireBitrixAuth, async (req, res) => {
  try {
    const dates = await listReportDates(req.params.taskId);
    res.json({ taskId: String(req.params.taskId), dates });
  } catch (error) {
    console.error(error);
    res.status(502).json({ error: error.message || 'Не удалось получить список отчётов' });
  }
});

/** Текст отчёта за конкретную дату */
router.get('/reports/:taskId/:date', requireBitrixAuth, async (req, res) => {
  try {
    const { taskId, date } = req.params;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'Дата должна быть в формате YYYY-MM-DD' });
    }

    const report = await getReportFromDisk(taskId, date);
    if (!report) {
      return res.status(404).json({ error: 'Отчёта за эту дату нет' });
    }

    let taskTitle = null;
    try {
      const task = await getTask(taskId);
      taskTitle = task.title;
    } catch {
      /* объект мог быть закрыт — не критично */
    }

    res.json({ ...report, taskTitle });
  } catch (error) {
    console.error(error);
    res.status(502).json({ error: error.message || 'Не удалось прочитать отчёт' });
  }
});

router.post('/reports', requireBitrixAuth, async (req, res) => {
  try {
    const body = req.body || {};
    const {
      taskId,
      date,
      authorName,
      workStartFrom,
      workStartTo,
      droneFrom,
      droneTo,
      staffItr,
      staffForemen,
      staffWorkers,
      workStage,
      techMeans,
      volumes,
      ppe,
      nextDay,
      problems,
    } = body;

    if (!taskId) {
      return res.status(400).json({ error: 'Выберите объект (задачу)' });
    }
    if (!workStartFrom || !workStartTo) {
      return res.status(400).json({ error: 'Укажите начало работ: с — по' });
    }
    if (!staffItr?.trim() || !staffForemen?.trim() || !staffWorkers?.trim()) {
      return res.status(400).json({ error: 'Заполните персонал: ИТР, бригадиры, рабочие' });
    }
    if (!workStage?.trim()) {
      return res.status(400).json({ error: 'Укажите этап работ' });
    }
    if (!techMeans?.trim()) {
      return res.status(400).json({ error: 'Укажите технические средства' });
    }
    if (!volumes?.trim()) {
      return res.status(400).json({ error: 'Укажите выполненные объёмы работ' });
    }
    if (!nextDay?.trim()) {
      return res.status(400).json({ error: 'Укажите работы на следующий день' });
    }

    const report = {
      date: date || new Date().toISOString().slice(0, 10),
      authorName: authorName?.trim() || req.bitrixUser?.name || '',
      workStartFrom,
      workStartTo,
      droneFrom: droneFrom || '',
      droneTo: droneTo || '',
      staffItr: staffItr.trim(),
      staffForemen: staffForemen.trim(),
      staffWorkers: staffWorkers.trim(),
      workStage,
      techMeans,
      volumes,
      ppe: ppe || '',
      nextDay,
      problems: problems || '',
    };

    if (!/^\d{4}-\d{2}-\d{2}$/.test(report.date)) {
      return res.status(400).json({ error: 'Некорректная дата' });
    }

    const saved = await saveReport(taskId, report);

    res.json({
      ok: true,
      taskId: saved.task.id,
      taskTitle: saved.task.title,
      date: report.date,
      disk: saved.disk,
      commentId: saved.commentId,
      mockMode,
      authorFromBitrix: Boolean(req.bitrixUser),
    });
  } catch (error) {
    console.error(error);
    res.status(502).json({ error: error.message || 'Не удалось сохранить отчёт' });
  }
});

/** События чат-бота (без пользовательского AUTH_ID — отдельный канал) */
router.post('/bot', async (req, res) => {
  const publicUrl = (process.env.APP_PUBLIC_URL || '').replace(/\/$/, '');
  const formUrl = publicUrl || `http://localhost:${process.env.PORT || 3000}`;
  const event = req.body?.event || req.body?.EVENT;
  const message =
    req.body?.data?.PARAMS?.MESSAGE ||
    req.body?.data?.params?.MESSAGE ||
    '';

  res.status(200).json({ result: 'ok' });
  if (!event) return;
  console.log('[bot]', event, String(message).slice(0, 120), '→', formUrl);
});

export default router;
