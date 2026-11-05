export const threadMethods = new Set([
  "thread/start",
  "thread/resume",
  "thread/fork",
]);
export const loadedThreadMethods = new Set([
  "thread/revert",
  "thread/rollback",
  "turn/start",
  "thread/compact/start",
  "review/start",
  "thread/goal/get",
  "thread/goal/set",
  "thread/goal/clear",
  "thread/backgroundTerminals/list",
  "thread/backgroundTerminals/clean",
]);
