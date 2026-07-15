const taskListEl = document.getElementById('task-list');
const tasksStatusEl = document.getElementById('tasks-status');
const taskPanel = document.getElementById('task-panel');
const formPanel = document.getElementById('form-panel');
const archivePanel = document.getElementById('archive-panel');
const successPanel = document.getElementById('success-panel');
const selectedTitle = document.getElementById('selected-title');
const archiveTitle = document.getElementById('archive-title');
const taskIdInput = document.getElementById('task-id');
const reportForm = document.getElementById('report-form');
const formError = document.getElementById('form-error');
const submitBtn = document.getElementById('submit-btn');
const searchInput = document.getElementById('task-search');
const modeHint = document.getElementById('mode-hint');
const dateListEl = document.getElementById('date-list');
const datesStatusEl = document.getElementById('dates-status');
const reportView = document.getElementById('report-view');
const reportContent = document.getElementById('report-content');
const reportViewDate = document.getElementById('report-view-date');

let mode = 'create'; // create | archive
let tasks = [];
let filtered = [];
let currentTask = null;
let lastSaved = null;

const statusLabel = {
  2: 'Ждёт выполнения',
  3: 'В работе',
  4: 'Ждёт контроля',
};

function todayLocal() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

document.getElementById('date').value = todayLocal();

function formatDeadline(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' });
}

function formatDateRu(iso) {
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}

function hideAllWorkPanels() {
  taskPanel.hidden = true;
  formPanel.hidden = true;
  archivePanel.hidden = true;
  successPanel.hidden = true;
}

function setMode(next) {
  mode = next;
  document.getElementById('tab-create').classList.toggle('is-active', mode === 'create');
  document.getElementById('tab-archive').classList.toggle('is-active', mode === 'archive');
  modeHint.textContent =
    mode === 'create'
      ? 'Выберите объект (задачу), заполните смену и отправьте — файл появится на Диске.'
      : 'Выберите объект → дату — откроется сохранённый отчёт.';
  document.getElementById('task-panel-title').textContent =
    mode === 'create' ? 'Объекты (задачи)' : 'Архив: выберите объект';

  currentTask = null;
  hideAllWorkPanels();
  taskPanel.hidden = false;
  loadTasks();
}

function renderTasks(list) {
  taskListEl.innerHTML = '';
  if (!list.length) {
    taskListEl.hidden = true;
    tasksStatusEl.hidden = false;
    tasksStatusEl.textContent = tasks.length
      ? 'Ничего не найдено по запросу'
      : 'Нет активных задач';
    return;
  }

  tasksStatusEl.hidden = true;
  taskListEl.hidden = false;

  const frag = document.createDocumentFragment();
  for (const task of list) {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';

    const title = document.createElement('span');
    title.className = 'task-title';
    title.textContent = task.title;

    const meta = document.createElement('span');
    meta.className = 'task-meta';

    const status = document.createElement('span');
    status.className = 'tag';
    status.textContent = statusLabel[task.status] || `Статус ${task.status}`;
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

    btn.append(title, meta);
    btn.addEventListener('click', () => selectTask(task));
    li.append(btn);
    frag.append(li);
  }
  taskListEl.append(frag);
}

function applyFilter() {
  const q = searchInput.value.trim().toLowerCase();
  filtered = q
    ? tasks.filter((t) => t.title.toLowerCase().includes(q) || String(t.id).includes(q))
    : tasks;
  renderTasks(filtered);
}

function selectTask(task) {
  currentTask = task;
  if (mode === 'create') {
    taskIdInput.value = task.id;
    selectedTitle.textContent = `${task.title} (#${task.id})`;
    hideAllWorkPanels();
    formPanel.hidden = false;
    formError.hidden = true;
    document.getElementById('works').focus();
    return;
  }

  archiveTitle.textContent = `${task.title} (#${task.id})`;
  hideAllWorkPanels();
  archivePanel.hidden = false;
  reportView.hidden = true;
  loadDates(task.id);
}

function showTaskPicker() {
  hideAllWorkPanels();
  taskPanel.hidden = false;
}

async function loadTasks() {
  tasksStatusEl.hidden = false;
  tasksStatusEl.classList.remove('error');
  tasksStatusEl.textContent = 'Загрузка задач…';
  taskListEl.hidden = true;

  try {
    const res = await fetch('/api/tasks');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Ошибка загрузки');
    tasks = data.tasks || [];
    applyFilter();
  } catch (err) {
    tasks = [];
    taskListEl.hidden = true;
    tasksStatusEl.hidden = false;
    tasksStatusEl.classList.add('error');
    tasksStatusEl.textContent = err.message || 'Не удалось загрузить задачи';
  }
}

async function loadDates(taskId) {
  dateListEl.hidden = true;
  dateListEl.innerHTML = '';
  reportView.hidden = true;
  datesStatusEl.hidden = false;
  datesStatusEl.classList.remove('error');
  datesStatusEl.textContent = 'Загрузка дат…';

  try {
    const res = await fetch(`/api/reports/${encodeURIComponent(taskId)}/dates`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Ошибка');

    const dates = data.dates || [];
    if (!dates.length) {
      datesStatusEl.textContent = 'По этому объекту отчётов пока нет';
      return;
    }

    datesStatusEl.hidden = true;
    dateListEl.hidden = false;
    const frag = document.createDocumentFragment();
    for (const date of dates) {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      const title = document.createElement('span');
      title.className = 'task-title';
      title.textContent = formatDateRu(date);
      const meta = document.createElement('span');
      meta.className = 'task-meta';
      meta.textContent = date;
      btn.append(title, meta);
      btn.addEventListener('click', () => openReport(taskId, date));
      li.append(btn);
      frag.append(li);
    }
    dateListEl.append(frag);
  } catch (err) {
    datesStatusEl.classList.add('error');
    datesStatusEl.textContent = err.message || 'Не удалось загрузить даты';
  }
}

async function openReport(taskId, date) {
  datesStatusEl.hidden = true;
  try {
    const res = await fetch(
      `/api/reports/${encodeURIComponent(taskId)}/${encodeURIComponent(date)}`
    );
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Ошибка чтения');

    dateListEl.hidden = true;
    reportView.hidden = false;
    reportViewDate.textContent = `Отчёт за ${formatDateRu(date)}`;
    reportContent.textContent = data.content || '';
  } catch (err) {
    datesStatusEl.hidden = false;
    datesStatusEl.classList.add('error');
    datesStatusEl.textContent = err.message || 'Не удалось открыть отчёт';
  }
}

reportForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  formError.hidden = true;

  const payload = Object.fromEntries(new FormData(reportForm).entries());
  if (!payload.taskId) {
    formError.textContent = 'Сначала выберите объект';
    formError.hidden = false;
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = 'Сохранение…';

  try {
    const res = await fetch('/api/reports', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Ошибка сохранения');

    lastSaved = { taskId: data.taskId, date: data.date, title: data.taskTitle };
    hideAllWorkPanels();
    successPanel.hidden = false;
    const where = data.mockMode
      ? 'локально (демо-папка data/mock-disk)'
      : 'на Диске Битрикс';
    document.getElementById('success-text').textContent =
      `«${data.taskTitle}» за ${formatDateRu(data.date)} — сохранено ${where}. В архиве: объект → эта дата.`;

    reportForm.reset();
    document.getElementById('date').value = todayLocal();
    taskIdInput.value = '';
  } catch (err) {
    const msg = String(err.message || '');
    formError.textContent =
      msg === 'Failed to fetch'
        ? 'Нет связи с сервером. Проверьте, что npm.cmd run dev запущен, и обновите страницу.'
        : msg || 'Не удалось сохранить отчёт';
    formError.hidden = false;
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Сохранить на Диск';
  }
});

document.getElementById('tab-create').addEventListener('click', () => setMode('create'));
document.getElementById('tab-archive').addEventListener('click', () => setMode('archive'));
document.getElementById('refresh-tasks').addEventListener('click', loadTasks);
document.getElementById('change-task').addEventListener('click', showTaskPicker);
document.getElementById('archive-change-task').addEventListener('click', showTaskPicker);
document.getElementById('back-to-dates').addEventListener('click', () => {
  reportView.hidden = true;
  if (currentTask) loadDates(currentTask.id);
});
document.getElementById('again-btn').addEventListener('click', () => setMode('create'));
document.getElementById('goto-archive-btn').addEventListener('click', () => {
  setMode('archive');
  if (lastSaved) {
    const task = tasks.find((t) => t.id === String(lastSaved.taskId)) || {
      id: lastSaved.taskId,
      title: lastSaved.title,
      status: 3,
    };
    selectTask(task);
  }
});
searchInput.addEventListener('input', applyFilter);

setMode('create');
