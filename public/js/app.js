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
const stepPrevBtn = document.getElementById('step-prev');
const stepNextBtn = document.getElementById('step-next');
const copyYesterdayBtn = document.getElementById('copy-yesterday-btn');
const draftHint = document.getElementById('draft-hint');
const wizardFill = document.getElementById('wizard-fill');
const wizardLabel = document.getElementById('wizard-label');
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

const TOTAL_STEPS = 4;
const STEP_TITLES = ['Смена', 'Персонал', 'Техника и объёмы', 'СИЗ и план'];
const DRAFT_PREFIX = 'ammir.report.draft.v1:';

let mode = 'create';
let tasks = [];
let filtered = [];
let currentTask = null;
let lastSaved = null;
let formStep = 1;
let draftTimer = null;
let bitrixUserName = '';
/** Редактирование существующего отчёта: { taskId, date } */
let editingReport = null;
/** Открытый в архиве отчёт */
let viewingReport = null;
let tokenRefreshTimer = null;

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

function shiftDate(iso, days) {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + days);
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

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
  editingReport = null;
  viewingReport = null;
  document.getElementById('tab-create').classList.toggle('is-active', mode === 'create');
  document.getElementById('tab-archive').classList.toggle('is-active', mode === 'archive');
  modeHint.textContent =
    mode === 'create'
      ? 'Выберите объект, заполните отчёт по шагам и сохраните на Диск.'
      : 'Выберите объект → дату — просмотр или редактирование отчёта.';
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

function draftKey(taskId) {
  return `${DRAFT_PREFIX}${taskId}`;
}

function readFormValues() {
  return Object.fromEntries(new FormData(reportForm).entries());
}

function fillFormFields(data, { keepDate = true, keepAuthor = true } = {}) {
  const map = {
    date: 'date',
    authorName: 'author-name',
    workStartFrom: 'work-start-from',
    workStartTo: 'work-start-to',
    droneFrom: 'drone-from',
    droneTo: 'drone-to',
    staffItr: 'staff-itr',
    staffForemen: 'staff-foremen',
    staffWorkers: 'staff-workers',
    workStage: 'work-stage',
    techMeans: 'tech-means',
    volumes: 'volumes',
    ppe: 'ppe',
    nextDay: 'next-day',
    problems: 'problems',
  };

  for (const [key, id] of Object.entries(map)) {
    if (data[key] == null) continue;
    if (key === 'date' && keepDate === false) continue;
    if (key === 'authorName' && keepAuthor && bitrixUserName) continue;
    const el = document.getElementById(id);
    if (el) el.value = data[key];
  }

  if (keepAuthor && bitrixUserName) {
    document.getElementById('author-name').value = bitrixUserName;
  }
  if (!document.getElementById('date').value) {
    document.getElementById('date').value = todayLocal();
  }
}

function saveDraft(reason = '') {
  const taskId = taskIdInput.value;
  if (!taskId) return;

  const payload = {
    ...readFormValues(),
    step: formStep,
    savedAt: new Date().toISOString(),
    reason,
  };

  try {
    localStorage.setItem(draftKey(taskId), JSON.stringify(payload));
    draftHint.hidden = false;
    draftHint.textContent =
      reason === 'offline'
        ? 'Черновик сохранён на устройстве (нет сети). Можно продолжить позже.'
        : 'Черновик сохранён на устройстве';
  } catch {
    /* quota / private mode */
  }
}

function loadDraft(taskId) {
  try {
    const raw = localStorage.getItem(draftKey(taskId));
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function clearDraft(taskId) {
  try {
    localStorage.removeItem(draftKey(taskId || taskIdInput.value));
  } catch {
    /* ignore */
  }
  draftHint.hidden = true;
}

function scheduleDraftSave() {
  clearTimeout(draftTimer);
  draftTimer = setTimeout(() => saveDraft('autosave'), 400);
}

function setFormStep(step) {
  formStep = Math.min(TOTAL_STEPS, Math.max(1, step));
  document.querySelectorAll('.form-step').forEach((el) => {
    const n = Number(el.dataset.step);
    const active = n === formStep;
    el.hidden = !active;
    el.classList.toggle('is-active', active);
  });

  wizardFill.style.width = `${(formStep / TOTAL_STEPS) * 100}%`;
  wizardLabel.textContent = `Шаг ${formStep} из ${TOTAL_STEPS} — ${STEP_TITLES[formStep - 1]}`;

  stepPrevBtn.hidden = formStep === 1;
  stepNextBtn.hidden = formStep === TOTAL_STEPS;
  submitBtn.hidden = formStep !== TOTAL_STEPS;
  formError.hidden = true;
  updateSubmitLabel();
}

function updateSubmitLabel() {
  submitBtn.textContent = editingReport ? 'Сохранить изменения' : 'Сохранить на Диск';
}

function validateStep(step) {
  const requiredByStep = {
    1: ['date', 'work-start-from', 'work-start-to'],
    2: ['staff-itr', 'staff-foremen', 'staff-workers', 'work-stage'],
    3: ['tech-means', 'volumes'],
    4: ['next-day'],
  };

  for (const id of requiredByStep[step] || []) {
    const el = document.getElementById(id);
    if (!el || !String(el.value || '').trim()) {
      el?.focus();
      return `Заполните обязательные поля шага «${STEP_TITLES[step - 1]}»`;
    }
  }
  return null;
}

function parseReportContent(content) {
  const text = String(content || '');
  const blockAfter = (label) => {
    const idx = text.indexOf(label);
    if (idx < 0) return '';
    let rest = text.slice(idx + label.length);
    const next = rest.search(/\n\d+\.\s/);
    if (next >= 0) rest = rest.slice(0, next);
    const chunk = rest.replace(/^\s+/, '').replace(/\s+$/, '');
    if (!chunk || chunk === '—' || chunk === '— нет') return '';
    return chunk;
  };

  const work = text.match(/1\.\s*Начало работ:\s*с\s*(\S+)\s*по\s*(\S+)/);
  const drone = text.match(/2\.\s*Беспилотная опасность:\s*(?:с\s*(\S+)\s*по\s*(\S+)|—)/);
  const normTime = (v) => {
    if (!v || v === '—') return '';
    return v.length === 5 ? v : v.slice(0, 5);
  };

  return {
    authorName: (text.match(/^Составил:\s*(.+)$/m) || [])[1]?.trim() || '',
    workStartFrom: normTime(work?.[1]),
    workStartTo: normTime(work?.[2]),
    droneFrom: normTime(drone?.[1]),
    droneTo: normTime(drone?.[2]),
    staffItr: (text.match(/ИТР:\s*(.+)/) || [])[1]?.trim() || '',
    staffForemen: (text.match(/Бригадиры:\s*(.+)/) || [])[1]?.trim() || '',
    staffWorkers: (text.match(/Рабочие:\s*(.+)/) || [])[1]?.trim() || '',
    workStage: blockAfter('4. Этап работ:'),
    techMeans: blockAfter('5. Используемые технические средства (с зав. номерами):'),
    volumes: blockAfter('6. Выполненные объёмы работ:'),
    ppe: blockAfter('7. Расход СИЗ:'),
    nextDay: blockAfter('8. Работы, запланированные на следующий день:'),
    problems: blockAfter('9. Возникшие проблемы:'),
  };
}

async function selectTask(task) {
  currentTask = task;
  if (mode === 'create') {
    editingReport = null;
    taskIdInput.value = task.id;
    selectedTitle.textContent = `${task.title} (#${task.id})`;
    hideAllWorkPanels();
    formPanel.hidden = false;
    formError.hidden = true;

    reportForm.reset();
    document.getElementById('date').value = todayLocal();
    if (bitrixUserName) {
      document.getElementById('author-name').value = bitrixUserName;
    }

    const draft = loadDraft(task.id);
    if (draft) {
      const when = draft.savedAt
        ? new Date(draft.savedAt).toLocaleString('ru-RU', {
            day: '2-digit',
            month: 'short',
            hour: '2-digit',
            minute: '2-digit',
          })
        : '';
      const restore = window.confirm(
        `Найден черновик${when ? ` от ${when}` : ''}. Восстановить?`
      );
      if (restore) {
        fillFormFields(draft, { keepDate: false, keepAuthor: false });
        if (draft.date) document.getElementById('date').value = draft.date;
        setFormStep(Number(draft.step) || 1);
        draftHint.hidden = false;
        draftHint.textContent = 'Восстановлен черновик с устройства';
      } else {
        setFormStep(1);
        draftHint.hidden = true;
      }
    } else {
      setFormStep(1);
      draftHint.hidden = true;
    }

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
  saveDraft('leave');
  hideAllWorkPanels();
  taskPanel.hidden = false;
}

async function apiFetch(url, options = {}, retried = false) {
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

  const res = await fetch(url, { ...options, headers });

  if (res.status === 401 && !retried) {
    const data = await res.clone().json().catch(() => ({}));
    const blob = `${data.error || ''} ${data.code || ''}`.toLowerCase();
    const looksExpired =
      blob.includes('expired') ||
      data.code === 'BITRIX_TOKEN_EXPIRED' ||
      data.code === 'BITRIX_AUTH_REQUIRED';

    if (looksExpired) {
      const refreshed = await refreshBitrixToken();
      if (refreshed) {
        return apiFetch(url, options, true);
      }
    }
  }

  return res;
}

function refreshBitrixToken() {
  return new Promise((resolve) => {
    if (typeof BX24 === 'undefined' || typeof BX24.refreshAuth !== 'function') {
      resolve(false);
      return;
    }

    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      resolve(ok);
    };

    const timer = setTimeout(() => finish(false), 8000);

    try {
      BX24.refreshAuth((auth) => {
        clearTimeout(timer);
        const token = auth?.access_token || BX24.getAuth()?.access_token;
        if (token) {
          bitrixAuth.accessToken = token;
          const domain = auth?.domain || BX24.getAuth()?.domain;
          if (domain) bitrixAuth.domain = domain;
          finish(true);
          return;
        }
        finish(false);
      });
    } catch {
      clearTimeout(timer);
      finish(false);
    }
  });
}

function startTokenAutoRefresh() {
  if (tokenRefreshTimer) clearInterval(tokenRefreshTimer);
  // Токен Битрикс живёт недолго — обновляем заранее
  tokenRefreshTimer = setInterval(() => {
    refreshBitrixToken().catch(() => {});
  }, 20 * 60 * 1000);
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
          if (typeof BX24.installFinish === 'function') {
            BX24.installFinish();
          }
        } catch {
          /* already installed */
        }
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
    bitrixUserName = meData.user.name;
    userBadge.hidden = false;
    userBadge.textContent = `Вы вошли: ${meData.user.name}`;
    const authorInput = document.getElementById('author-name');
    if (authorInput && !authorInput.value) {
      authorInput.value = meData.user.name;
    }
  }
  startTokenAutoRefresh();
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

    viewingReport = { taskId: String(taskId), date, content: data.content || '' };
    dateListEl.hidden = true;
    reportView.hidden = false;
    reportViewDate.textContent = `Отчёт за ${formatDateRu(date)}`;
    reportContent.textContent = data.content || '';
  } catch (err) {
    viewingReport = null;
    datesStatusEl.hidden = false;
    datesStatusEl.classList.add('error');
    datesStatusEl.textContent = err.message || 'Не удалось открыть отчёт';
  }
}

function startEditReport() {
  if (!viewingReport || !currentTask) return;

  const { taskId, date, content } = viewingReport;
  const parsed = parseReportContent(content);

  mode = 'create';
  document.getElementById('tab-create').classList.add('is-active');
  document.getElementById('tab-archive').classList.remove('is-active');
  modeHint.textContent = `Редактирование отчёта за ${formatDateRu(date)}. После сохранения файл на Диске обновится.`;

  editingReport = { taskId: String(taskId), date };
  taskIdInput.value = taskId;
  selectedTitle.textContent = `${currentTask.title} (#${taskId})`;

  hideAllWorkPanels();
  formPanel.hidden = false;
  formError.hidden = true;

  fillFormFields(parsed, { keepDate: false, keepAuthor: false });
  document.getElementById('date').value = date;
  if (bitrixUserName && !document.getElementById('author-name').value) {
    document.getElementById('author-name').value = bitrixUserName;
  }

  setFormStep(1);
  draftHint.hidden = false;
  draftHint.textContent = `Редактирование отчёта за ${formatDateRu(date)}`;
  document.getElementById('work-start-from').focus();
}

async function copyYesterdayReport() {
  const taskId = taskIdInput.value;
  if (!taskId) return;

  copyYesterdayBtn.disabled = true;
  copyYesterdayBtn.textContent = 'Загрузка…';
  formError.hidden = true;

  try {
    const datesRes = await apiFetch(`/api/reports/${encodeURIComponent(taskId)}/dates`);
    const datesData = await datesRes.json();
    if (!datesRes.ok) throw new Error(datesData.error || 'Не удалось получить даты');

    const dates = datesData.dates || [];
    const today = document.getElementById('date').value || todayLocal();
    const yesterday = shiftDate(today, -1);
    const sourceDate =
      dates.find((d) => d === yesterday) || dates.find((d) => d < today) || dates[0];

    if (!sourceDate) {
      throw new Error('По этому объекту ещё нет сохранённых отчётов');
    }

    const res = await apiFetch(
      `/api/reports/${encodeURIComponent(taskId)}/${encodeURIComponent(sourceDate)}`
    );
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Не удалось прочитать отчёт');

    const parsed = parseReportContent(data.content);
    fillFormFields(parsed, { keepDate: true, keepAuthor: true });
    document.getElementById('date').value = today;
    saveDraft('copy');
    setFormStep(1);
    draftHint.hidden = false;
    draftHint.textContent = `Скопирован отчёт за ${formatDateRu(sourceDate)}. Проверьте поля и дату.`;
  } catch (err) {
    formError.textContent = err.message || 'Не удалось скопировать отчёт';
    formError.hidden = false;
  } finally {
    copyYesterdayBtn.disabled = false;
    copyYesterdayBtn.textContent = 'Копировать вчерашний';
  }
}

async function reportExistsForDate(taskId, date) {
  const res = await apiFetch(`/api/reports/${encodeURIComponent(taskId)}/dates`);
  const data = await res.json();
  if (!res.ok) return false;
  return (data.dates || []).includes(date);
}

stepPrevBtn.addEventListener('click', () => {
  saveDraft('step');
  setFormStep(formStep - 1);
});

stepNextBtn.addEventListener('click', () => {
  const error = validateStep(formStep);
  if (error) {
    formError.textContent = error;
    formError.hidden = false;
    return;
  }
  saveDraft('step');
  setFormStep(formStep + 1);
});

copyYesterdayBtn.addEventListener('click', copyYesterdayReport);

reportForm.addEventListener('input', scheduleDraftSave);
reportForm.addEventListener('change', scheduleDraftSave);

window.addEventListener('offline', () => {
  if (taskIdInput.value && !formPanel.hidden) {
    saveDraft('offline');
  }
});

reportForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  formError.hidden = true;

  for (let step = 1; step <= TOTAL_STEPS; step += 1) {
    const error = validateStep(step);
    if (error) {
      setFormStep(step);
      formError.textContent = error;
      formError.hidden = false;
      return;
    }
  }

  const payload = readFormValues();
  if (!payload.taskId) {
    formError.textContent = 'Сначала выберите объект';
    formError.hidden = false;
    return;
  }

  try {
    const editingSame =
      editingReport &&
      String(editingReport.taskId) === String(payload.taskId) &&
      editingReport.date === payload.date;

    if (!editingSame) {
      const exists = await reportExistsForDate(payload.taskId, payload.date);
      if (exists) {
        const ok = window.confirm(
          `Отчёт за ${formatDateRu(payload.date)} уже есть на Диске.\nПерезаписать его?`
        );
        if (!ok) return;
      }
    }
  } catch {
    /* если проверка не удалась — всё равно даём сохранить */
  }

  submitBtn.disabled = true;
  submitBtn.textContent = 'Сохранение…';

  try {
    const res = await apiFetch('/api/reports', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Ошибка сохранения');

    const wasEdit = Boolean(editingReport);
    clearDraft(payload.taskId);
    editingReport = null;
    lastSaved = { taskId: data.taskId, date: data.date, title: data.taskTitle };
    hideAllWorkPanels();
    successPanel.hidden = false;
    const where = data.mockMode
      ? 'локально (демо-папка data/mock-disk)'
      : 'на Диске Битрикс';
    document.getElementById('success-text').textContent = wasEdit
      ? `«${data.taskTitle}» за ${formatDateRu(data.date)} — изменения сохранены ${where}.`
      : `«${data.taskTitle}» за ${formatDateRu(data.date)} — сохранено ${where}. В архиве: объект → эта дата.`;

    reportForm.reset();
    document.getElementById('date').value = todayLocal();
    taskIdInput.value = '';
    setFormStep(1);
    if (bitrixUserName) {
      document.getElementById('author-name').value = bitrixUserName;
    }
  } catch (err) {
    saveDraft('offline');
    const msg = String(err.message || '');
    formError.textContent =
      msg === 'Failed to fetch' || !navigator.onLine
        ? 'Нет сети. Черновик сохранён на устройстве — откройте объект снова, когда появится связь.'
        : msg || 'Не удалось сохранить отчёт. Черновик сохранён на устройстве.';
    formError.hidden = false;
  } finally {
    submitBtn.disabled = false;
    updateSubmitLabel();
  }
});

document.getElementById('tab-create').addEventListener('click', () => setMode('create'));
document.getElementById('tab-archive').addEventListener('click', () => setMode('archive'));
document.getElementById('refresh-tasks').addEventListener('click', loadTasks);
document.getElementById('change-task').addEventListener('click', showTaskPicker);
document.getElementById('archive-change-task').addEventListener('click', showTaskPicker);
document.getElementById('back-to-dates').addEventListener('click', () => {
  reportView.hidden = true;
  viewingReport = null;
  if (currentTask) loadDates(currentTask.id);
});
document.getElementById('edit-report-btn').addEventListener('click', startEditReport);
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

document.getElementById('date').value = todayLocal();
setFormStep(1);

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
