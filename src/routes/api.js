import { Router } from 'express';
import {
  listActiveTasks,
  getTask,
  saveReport,
  listReportDates,
  getReportFromDisk,
  mockMode,
} from '../bitrix.js';

const router = Router();

router.get('/status', (_req, res) => {
  res.json({
    mockMode,
    storage: mockMode ? 'local:data/mock-disk' : 'bitrix-disk',
  });
});

router.get('/tasks', async (_req, res) => {
  try {
    const tasks = await listActiveTasks();
    res.json({ tasks });
  } catch (error) {
    console.error(error);
    res.status(502).json({ error: error.message || 'Не удалось загрузить задачи' });
  }
});

router.get('/tasks/:id', async (req, res) => {
  try {
    const task = await getTask(req.params.id);
    res.json({ task });
  } catch (error) {
    console.error(error);
    res.status(502).json({ error: error.message || 'Не удалось загрузить задачу' });
  }
});

/** Список дат, по которым есть отчёты для объекта (задачи) */
router.get('/reports/:taskId/dates', async (req, res) => {
  try {
    const dates = await listReportDates(req.params.taskId);
    res.json({ taskId: String(req.params.taskId), dates });
  } catch (error) {
    console.error(error);
    res.status(502).json({ error: error.message || 'Не удалось получить список отчётов' });
  }
});

/** Текст отчёта за конкретную дату */
router.get('/reports/:taskId/:date', async (req, res) => {
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

router.post('/reports', async (req, res) => {
  try {
    const {
      taskId,
      date,
      authorName,
      works,
      problems,
      peopleCount,
      equipment,
      materials,
      progress,
      notes,
    } = req.body || {};

    if (!taskId) {
      return res.status(400).json({ error: 'Выберите объект (задачу)' });
    }
    if (!works?.trim()) {
      return res.status(400).json({ error: 'Укажите выполненные работы' });
    }
    const people = Number(peopleCount);
    if (!Number.isFinite(people) || people < 0) {
      return res.status(400).json({ error: 'Укажите корректное количество людей' });
    }

    const report = {
      date: date || new Date().toISOString().slice(0, 10),
      authorName: authorName?.trim() || '',
      works,
      problems: problems || '',
      peopleCount: people,
      equipment: equipment || '',
      materials: materials || '',
      progress: progress === '' || progress == null ? '' : Number(progress),
      notes: notes || '',
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
    });
  } catch (error) {
    console.error(error);
    res.status(502).json({ error: error.message || 'Не удалось сохранить отчёт' });
  }
});

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
