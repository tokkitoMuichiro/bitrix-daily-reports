import { TASK_PAGE_SIZE, statusLabel, statusClass } from '../constants.js';
import { state } from '../state.js';
import { dom } from '../dom.js';
import { apiFetch } from '../api/client.js';
import { archiveStatusText, formatDeadline } from '../utils/dates.js';

/** @type {(task: object) => void} */
let onSelectTask = () => {};

export function setTaskSelectHandler(fn) {
  onSelectTask = typeof fn === 'function' ? fn : () => {};
}

function createTaskListItem(task) {
  const li = document.createElement('li');
  li.dataset.taskId = task.id;
  const btn = document.createElement('button');
  btn.type = 'button';
  if (task.status === 2) btn.classList.add('status-planned');
  else if (task.status === 3) btn.classList.add('status-progress');
  else if (task.status === 4) btn.classList.add('status-review');

  const title = document.createElement('span');
  title.className = 'task-title';
  title.textContent = task.title;

  const meta = document.createElement('span');
  meta.className = 'task-meta';

  const status = document.createElement('span');
  if (state.mode === 'archive' || task.status == null) {
    status.className = 'tag tag--other';
    status.textContent = archiveStatusText(task);
  } else {
    status.className = `tag ${statusClass[task.status] || 'tag--other'}`;
    status.textContent = statusLabel[task.status] || `Статус ${task.status}`;
  }
  meta.append(status);

  const deadline = formatDeadline(task.deadline);
  if (deadline) {
    const dl = document.createElement('span');
    dl.textContent = `срок ${deadline}`;
    meta.append(dl);
  }

  const id = document.createElement('span');
  id.textContent = `#${task.id}`;
  meta.append(id);

  if (state.mode === 'schedules') {
    const badge = document.createElement('span');
    badge.className = 'tag tag--schedule';
    badge.dataset.scheduleBadge = task.id;
    badge.textContent = '…';
    meta.append(badge);
  }

  btn.append(title, meta);
  btn.addEventListener('click', () => onSelectTask(task));
  li.append(btn);
  return li;
}

function ensureTaskScrollSentinel() {
  const { taskListEl } = dom();
  let sentinel = document.getElementById('task-scroll-sentinel');
  if (!sentinel) {
    sentinel = document.createElement('li');
    sentinel.id = 'task-scroll-sentinel';
    sentinel.setAttribute('aria-hidden', 'true');
    taskListEl.append(sentinel);
  } else {
    taskListEl.append(sentinel);
  }
  return sentinel;
}

function setupTaskScrollObserver() {
  const { taskListEl } = dom();
  const sentinel = ensureTaskScrollSentinel();
  if (state.taskScrollObserver) {
    state.taskScrollObserver.disconnect();
  }
  state.taskScrollObserver = new IntersectionObserver(
    (entries) => {
      if (entries[0]?.isIntersecting) {
        loadTasks(false);
      }
    },
    { root: taskListEl, rootMargin: '120px' }
  );
  state.taskScrollObserver.observe(sentinel);
}

function updateTasksLoadMoreHint() {
  const { tasksLoadMoreEl } = dom();
  if (state.taskListLoading) {
    tasksLoadMoreEl.hidden = false;
    tasksLoadMoreEl.textContent = 'Загрузка…';
    return;
  }
  if (!state.tasks.length) {
    tasksLoadMoreEl.hidden = true;
    return;
  }
  if (state.taskFeed.hasMore) {
    tasksLoadMoreEl.hidden = false;
    tasksLoadMoreEl.textContent = 'Прокрутите вниз — подгрузим ещё';
  } else {
    tasksLoadMoreEl.hidden = false;
    tasksLoadMoreEl.textContent = state.taskFeed.query
      ? 'Больше совпадений нет'
      : 'Все задачи загружены';
  }
}

function renderTasks(list) {
  const { taskListEl, tasksStatusEl, tasksLoadMoreEl } = dom();
  taskListEl.innerHTML = '';
  if (!list.length) {
    taskListEl.hidden = true;
    tasksStatusEl.hidden = false;
    tasksStatusEl.textContent = state.taskFeed.query
      ? 'Ничего не найдено — уточните запрос'
      : state.mode === 'archive'
        ? 'Пока нет сохранённых отчётов'
        : state.mode === 'schedules'
          ? 'Нет активных задач'
          : 'Нет активных задач';
    tasksLoadMoreEl.hidden = true;
    return;
  }

  tasksStatusEl.hidden = true;
  taskListEl.hidden = false;

  const frag = document.createDocumentFragment();
  for (const task of list) {
    frag.append(createTaskListItem(task));
  }
  taskListEl.append(frag);
  ensureTaskScrollSentinel();
  setupTaskScrollObserver();
  updateTasksLoadMoreHint();
  markSchedulePresence(list);
}

function appendTasks(newTasks) {
  const { taskListEl } = dom();
  const existing = new Set(state.tasks.map((t) => t.id));
  const fresh = newTasks.filter((t) => !existing.has(t.id));
  if (!fresh.length) return;

  state.tasks.push(...fresh);
  const sentinel = document.getElementById('task-scroll-sentinel');
  for (const task of fresh) {
    if (sentinel) {
      taskListEl.insertBefore(createTaskListItem(task), sentinel);
    } else {
      taskListEl.append(createTaskListItem(task));
    }
  }
  ensureTaskScrollSentinel();
  updateTasksLoadMoreHint();
  markSchedulePresence(fresh);
}

export async function loadTasks(reset = true) {
  const { searchInput, taskListEl, tasksStatusEl, tasksLoadMoreEl } = dom();
  if (state.taskListLoading) return;
  if (!reset && !state.taskFeed.hasMore) return;

  const query = searchInput.value.trim();

  if (reset) {
    state.taskFeed.nextStart = 0;
    state.taskFeed.hasMore = true;
    state.taskFeed.query = query;
    state.tasks = [];
    taskListEl.innerHTML = '';
    tasksStatusEl.hidden = false;
    tasksStatusEl.classList.remove('error');
    tasksStatusEl.textContent =
      state.mode === 'archive'
        ? query
          ? 'Поиск по архиву…'
          : 'Загрузка объектов с отчётами…'
        : query
          ? 'Поиск в Битрикс…'
          : state.mode === 'schedules'
            ? 'Загрузка объектов…'
            : 'Загрузка задач…';
    taskListEl.hidden = true;
    tasksLoadMoreEl.hidden = true;
  }

  state.taskListLoading = true;
  updateTasksLoadMoreHint();

  try {
    const params = new URLSearchParams({
      start: String(state.taskFeed.nextStart),
      limit: String(TASK_PAGE_SIZE),
    });
    if (query) params.set('q', query);

    const endpoint = state.mode === 'archive' ? '/api/archive/tasks' : '/api/tasks';
    const res = await apiFetch(`${endpoint}?${params}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Ошибка загрузки');

    const batch = data.tasks || [];
    state.taskFeed.nextStart = data.nextStart ?? state.taskFeed.nextStart + batch.length;
    state.taskFeed.hasMore = Boolean(data.hasMore);

    if (reset) {
      state.tasks = batch;
      renderTasks(state.tasks);
    } else {
      appendTasks(batch);
    }
  } catch (err) {
    if (reset) {
      state.tasks = [];
      taskListEl.hidden = true;
      tasksStatusEl.hidden = false;
      tasksStatusEl.classList.add('error');
      tasksStatusEl.textContent = err.message || 'Не удалось загрузить задачи';
      tasksLoadMoreEl.hidden = true;
    } else {
      updateTasksLoadMoreHint();
      tasksLoadMoreEl.textContent = 'Не удалось подгрузить — прокрутите ещё раз';
    }
  } finally {
    state.taskListLoading = false;
    updateTasksLoadMoreHint();
  }
}

async function markSchedulePresence(tasks) {
  if (state.mode !== 'schedules' || !tasks?.length) return;
  try {
    const res = await apiFetch('/api/schedules/presence', {
      method: 'POST',
      body: JSON.stringify({ ids: tasks.map((task) => task.id) }),
    });
    const data = await res.json();
    if (!res.ok) return;
    const presence = data.presence || {};
    for (const task of tasks) {
      const badge = document.querySelector(`[data-schedule-badge="${CSS.escape(task.id)}"]`);
      if (!badge) continue;
      const exists = Boolean(presence[task.id]);
      badge.textContent = exists ? 'график есть' : 'график отсутствует';
      badge.classList.toggle('tag--ok', exists);
    }
  } catch {
    /* список объектов остаётся рабочим и без отметок */
  }
}

export function onTaskSearchInput() {
  clearTimeout(state.taskSearchTimer);
  state.taskSearchTimer = setTimeout(() => loadTasks(true), 400);
}
