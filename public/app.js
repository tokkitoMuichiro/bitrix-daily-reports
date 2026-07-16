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
const authGate = document.getElementById('auth-gate');
const authGateText = document.getElementById('auth-gate-text');
const authGateError = document.getElementById('auth-gate-error');
const appRoot = document.getElementById('app-root');
const userBadge = document.getElementById('user-badge');

let mode = 'create'; // create | archive
let tasks = [];
let filtered = [];
let currentTask = null;
let lastSaved = null;

/** Токен сессии Битрикс (из iframe локального приложения) */
const bitrixAuth = {
  accessToken: '',
  domain: '',
};

const statusLabel = {
  2: 'Планируется',
  3: 'В работе',
  4: 'Ждёт контроля',
};

const statusClass = {
  2: 'tag--planned',
  3: 'tag--progress',
  4: 'tag--review',
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
    if (task.status === 2) btn.classList.add('status-planned');
    else if (task.status === 3) btn.classList.add('status-progress');
    else if (task.status === 4) btn.classList.add('status-review');

    const title = document.createElement('span');
    title.className = 'task-title';
    title.textContent = task.title;

    const meta = document.createElement('span');
    meta.className = 'task-meta';

    const status = document.createElement('span');
    status.className = `tag ${statusClass[task.status] || 'tag--other'}`;
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
    document.getElementById('work-start-from').focus();
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

/** Все запросы к API с токеном Битрикс */
async function apiFetch(url, options = {}) {
  const headers = new Headers(options.headers || {});
  if (bitrixAuth.accessToken) {
    headers.set('X-Bitrix-Auth-Id', bitrixAuth.accessToken);
  }
  if (bitrixAuth.domain) {
    headers.set('X-Bitrix-Domain', bitrixAuth.domain);
  }
  if (options.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  return fetch(url, { ...options, headers });
}

function readAuthFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return {
    accessToken: params.get('AUTH_ID') || params.get('auth') || '',
    domain: params.get('DOMAIN') || params.get('domain') || '',
  };
}

function loadBx24Auth() {
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

function showAuthGate(message, detail) {
  authGate.hidden = false;
  appRoot.hidden = true;
  if (message) authGateText.textContent = message;
  if (detail) {
    authGateError.textContent = detail;
    authGateError.hidden = false;
  } else {
    authGateError.hidden = true;
  }
}

function hideAuthGate() {
  authGate.hidden = true;
  appRoot.hidden = false;
}

async function bootstrapAuth() {
  const configRes = await fetch('/api/auth/config');
  const config = await configRes.json();

  const auth = await loadBx24Auth();
  bitrixAuth.accessToken = auth.accessToken || '';
  bitrixAuth.domain = auth.domain || config.portal || '';

  if (!config.required) {
    hideAuthGate();
    return { user: null, required: false };
  }

  if (!bitrixAuth.accessToken) {
    showAuthGate(
      `Откройте «АММИР отчёт» из меню Битрикс24 (${config.portal}). Прямая ссылка в браузере без входа не работает.`,
      'Токен авторизации не получен.'
    );
    return { user: null, required: true, ok: false };
  }

  const meRes = await apiFetch('/api/auth/me');
  const meData = await meRes.json().catch(() => ({}));
  if (!meRes.ok) {
    showAuthGate(
      'Не удалось подтвердить вход в Битрикс. Откройте приложение снова из меню портала.',
      meData.error || `Ошибка ${meRes.status}`
    );
    return { user: null, required: true, ok: false };
  }

  hideAuthGate();
  if (meData.user?.name) {
    userBadge.hidden = false;
    userBadge.textContent = `Вы вошли: ${meData.user.name}`;
    const authorInput = document.getElementById('author-name');
    if (authorInput && !authorInput.value) {
      authorInput.value = meData.user.name;
    }
  }
  return { user: meData.user, required: true, ok: true };
}

async function loadTasks() {
  tasksStatusEl.hidden = false;
  tasksStatusEl.classList.remove('error');
  tasksStatusEl.textContent = 'Загрузка задач…';
  taskListEl.hidden = true;

  try {
    const res = await apiFetch('/api/tasks');
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
    const res = await apiFetch(`/api/reports/${encodeURIComponent(taskId)}/dates`);
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
    const res = await apiFetch(
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
    const res = await apiFetch('/api/reports', {
      method: 'POST',
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
    if (userBadge.textContent.startsWith('Вы вошли:')) {
      const name = userBadge.textContent.replace('Вы вошли: ', '');
      document.getElementById('author-name').value = name;
    }
  } catch (err) {
    const msg = String(err.message || '');
    formError.textContent =
      msg === 'Failed to fetch'
        ? 'Нет связи с сервером. Проверьте, что сервер запущен, и обновите страницу.'
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

(async function start() {
  try {
    const session = await bootstrapAuth();
    if (session.required && session.ok === false) return;
    setMode('create');
  } catch (err) {
    showAuthGate(
      'Не удалось инициализировать вход. Откройте приложение из Битрикс24.',
      err.message || String(err)
    );
  }
})();
