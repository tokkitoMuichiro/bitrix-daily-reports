/** Shared UI / app constants */

export const TOTAL_STEPS = 4;
export const STEP_TITLES = ['Смена', 'Персонал', 'Техника и объёмы', 'СИЗ и план'];
export const DRAFT_PREFIX = 'ammir.report.draft.v1:';
export const TASK_PAGE_SIZE = 30;

export const statusLabel = {
  2: 'Планируется',
  3: 'В работе',
  4: 'Ждёт контроля',
};

export const statusClass = {
  2: 'tag--planned',
  3: 'tag--progress',
  4: 'tag--review',
};
