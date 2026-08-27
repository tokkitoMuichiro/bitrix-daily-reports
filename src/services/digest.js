import 'dotenv/config';
import { listAllActiveTasks, sendChatMessage, mockMode } from './bitrix.js';
import { listReportDates } from './disk.js';

const digestChatId = String(process.env.BITRIX_DIGEST_CHAT_ID || 'chat6032').trim();
const digestEnabled =
  process.env.BITRIX_DIGEST_ENABLED !== '0' && process.env.BITRIX_DIGEST_ENABLED !== 'false';
const digestHour = Number(process.env.BITRIX_DIGEST_HOUR ?? 21);
const digestMinute = Number(process.env.BITRIX_DIGEST_MINUTE ?? 0);

export function getDigestConfig() {
  return {
    enabled: digestEnabled,
    chatId: digestChatId,
    hour: digestHour,
    minute: digestMinute,
    timezone: 'Europe/Moscow',
  };
}

/** Сегодняшняя дата YYYY-MM-DD по Москве */
export function todayMoscow() {
  const parts = moscowDateParts(new Date());
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function moscowDateParts(date) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const map = Object.fromEntries(
    fmt.formatToParts(date).filter((p) => p.type !== 'literal').map((p) => [p.type, p.value])
  );
  return {
    year: map.year,
    month: map.month,
    day: map.day,
    hour: Number(map.hour),
    minute: Number(map.minute),
  };
}

function formatDateHuman(iso) {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso || '';
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}

function formatTaskLine(task) {
  return `• ${task.title} (#${task.id})`;
}

/**
 * Сводка: какие активные задачи имеют отчёт за дату, какие нет.
 */
export async function buildDailyDigest(date = todayMoscow()) {
  const tasks = await listAllActiveTasks();
  const withReport = [];
  const withoutReport = [];

  for (const task of tasks) {
    let dates = [];
    try {
      dates = await listReportDates(task.id);
    } catch (err) {
      console.warn(`[digest] даты для задачи ${task.id}:`, err.message);
    }
    if (dates.includes(date)) {
      withReport.push(task);
    } else {
      withoutReport.push(task);
    }
  }

  const lines = [
    `Отчёты за ${formatDateHuman(date)}`,
    `Активных объектов: ${tasks.length}`,
    '',
    `С отчётом (${withReport.length}):`,
    ...(withReport.length ? withReport.map(formatTaskLine) : ['• —']),
    '',
    `Без отчёта (${withoutReport.length}):`,
    ...(withoutReport.length ? withoutReport.map(formatTaskLine) : ['• —']),
  ];

  return {
    date,
    tasksTotal: tasks.length,
    withReport,
    withoutReport,
    message: lines.join('\n'),
  };
}

/**
 * Построить сводку и отправить в чат проекта.
 */
export async function sendDailyDigest({ date } = {}) {
  const digestDate = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : todayMoscow();
  const digest = await buildDailyDigest(digestDate);

  if (!digestChatId) {
    throw new Error('Не задан BITRIX_DIGEST_CHAT_ID');
  }

  if (mockMode) {
    console.log(`[digest] демо-режим, в чат не отправлено (${digestChatId}):\n${digest.message}`);
    return {
      ...digest,
      chatId: digestChatId,
      messageId: null,
      mock: true,
    };
  }

  const messageId = await sendChatMessage(digestChatId, digest.message);
  console.log(
    `[digest] отправлено в ${digestChatId} за ${digestDate}: ` +
      `есть ${digest.withReport.length}, нет ${digest.withoutReport.length}`
  );

  return {
    ...digest,
    chatId: digestChatId,
    messageId,
    mock: false,
  };
}

/**
 * Планировщик: каждый день в hour:minute по Москве.
 * Проверка раз в 30 сек; один раз за календарный день.
 */
export function startDigestScheduler() {
  const cfg = getDigestConfig();
  if (!cfg.enabled) {
    console.log('[digest] автоотправка выключена (BITRIX_DIGEST_ENABLED=0)');
    return;
  }
  if (!cfg.chatId) {
    console.warn('[digest] BITRIX_DIGEST_CHAT_ID пуст — автоотправка не запущена');
    return;
  }

  let lastSentDayKey = null;
  console.log(
    `[digest] автоотправка: каждый день в ${String(cfg.hour).padStart(2, '0')}:${String(cfg.minute).padStart(2, '0')} МСК → ${cfg.chatId}`
  );

  const tick = async () => {
    try {
      const parts = moscowDateParts(new Date());
      if (parts.hour !== cfg.hour || parts.minute !== cfg.minute) return;

      const dayKey = `${parts.year}-${parts.month}-${parts.day}`;
      if (lastSentDayKey === dayKey) return;
      lastSentDayKey = dayKey;

      await sendDailyDigest({ date: dayKey });
    } catch (err) {
      console.error('[digest] ошибка автоотправки:', err.message || err);
    }
  };

  setInterval(tick, 30_000);
  tick();
}
