/**
 * Mutable app state — single source of truth for UI modules.
 * Import this object and mutate fields in place (same behavior as former module-level lets).
 */

export const state = {
  mode: 'create',
  /** @type {Array<object>} */
  tasks: [],
  currentTask: null,
  lastSaved: null,
  formStep: 1,
  draftTimer: null,
  bitrixUserName: '',
  /** @type {{ taskId: string, date: string } | null} */
  editingReport: null,
  /** @type {{ taskId: string, date: string, content: string } | null} */
  viewingReport: null,
  scheduleBoard: null,
  scheduleResizeBound: false,
  tokenRefreshTimer: null,
  taskSearchTimer: null,
  taskScrollObserver: null,
  taskListLoading: false,
  taskFeed: {
    nextStart: 0,
    hasMore: true,
    query: '',
  },
  bitrixAuth: {
    accessToken: '',
    domain: '',
  },
};
