/**
 * Lazy DOM refs — resolved on first access after the document is parsed.
 */

function el(id) {
  const node = document.getElementById(id);
  if (!node) {
    throw new Error(`DOM: не найден #${id}`);
  }
  return node;
}

let cache = null;

export function dom() {
  if (cache) return cache;
  cache = {
    taskListEl: el('task-list'),
    tasksStatusEl: el('tasks-status'),
    taskPanel: el('task-panel'),
    formPanel: el('form-panel'),
    archivePanel: el('archive-panel'),
    schedulePanel: el('schedule-panel'),
    successPanel: el('success-panel'),
    selectedTitle: el('selected-title'),
    archiveTitle: el('archive-title'),
    taskIdInput: el('task-id'),
    reportForm: el('report-form'),
    formError: el('form-error'),
    submitBtn: el('submit-btn'),
    stepPrevBtn: el('step-prev'),
    stepNextBtn: el('step-next'),
    copyYesterdayBtn: el('copy-yesterday-btn'),
    draftHint: el('draft-hint'),
    wizardFill: el('wizard-fill'),
    wizardLabel: el('wizard-label'),
    searchInput: el('task-search'),
    tasksLoadMoreEl: el('tasks-load-more'),
    modeHint: el('mode-hint'),
    dateListEl: el('date-list'),
    datesStatusEl: el('dates-status'),
    reportView: el('report-view'),
    reportContent: el('report-content'),
    reportViewDate: el('report-view-date'),
    authGate: el('auth-gate'),
    authGateText: el('auth-gate-text'),
    authGateError: el('auth-gate-error'),
    appRoot: el('app-root'),
    userBadge: el('user-badge'),
    dronePeriodsEl: el('drone-periods'),
    addDronePeriodBtn: el('add-drone-period'),
    tabCreate: el('tab-create'),
    tabArchive: el('tab-archive'),
    tabSchedules: el('tab-schedules'),
    scheduleTitle: el('schedule-title'),
    scheduleStatus: el('schedule-status'),
    scheduleEmpty: el('schedule-empty'),
    scheduleEditor: el('schedule-editor'),
    scheduleEditorRows: el('schedule-editor-rows'),
    scheduleEditorError: el('schedule-editor-error'),
    scheduleBoardWrap: el('schedule-board-wrap'),
    scheduleBoard: el('schedule-board'),
    scheduleExportBtn: el('schedule-export-btn'),
    scheduleEditBtn: el('schedule-edit-btn'),
    scheduleCreateBtn: el('schedule-create-btn'),
    scheduleAddRowBtn: el('schedule-add-row'),
    scheduleSaveBtn: el('schedule-save-btn'),
    scheduleCancelBtn: el('schedule-cancel-btn'),
    scheduleDeleteBtn: el('schedule-delete-btn'),
    scheduleChangeTaskBtn: el('schedule-change-task'),
    scheduleDialog: el('schedule-dialog'),
    scheduleDialogDate: el('schedule-dialog-date'),
    scheduleDialogVolumes: el('schedule-dialog-volumes'),
    scheduleDialogBody: el('schedule-dialog-body'),
    scheduleDialogClose: el('schedule-dialog-close'),
    scheduleItemsBlock: el('schedule-items-block'),
    scheduleItemsEl: el('schedule-items'),
    taskPanelTitle: el('task-panel-title'),
    refreshTasksBtn: el('refresh-tasks'),
    sendDigestBtn: el('send-digest-btn'),
    changeTaskBtn: el('change-task'),
    archiveChangeTaskBtn: el('archive-change-task'),
    backToDatesBtn: el('back-to-dates'),
    editReportBtn: el('edit-report-btn'),
    againBtn: el('again-btn'),
    gotoArchiveBtn: el('goto-archive-btn'),
    successText: el('success-text'),
    dateInput: el('date'),
    authorNameInput: el('author-name'),
    workStartFromInput: el('work-start-from'),
  };
  return cache;
}
