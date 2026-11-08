// 产品操作按状态所有者分组。现有 RPC 名称保留为浏览器的传输契约。
export const workspaceMethods = Object.freeze([
  "fs/readDirectory",
  "fs/writeFile",
  "fs/uploadAttachment",
  "command/exec",
  "command/exec/write",
  "command/exec/resize",
  "command/exec/terminate",
]);
export const conversationMethods = Object.freeze([
  "thread/list",
  "thread/start",
  "thread/read",
  "thread/resume",
  "thread/unsubscribe",
  "thread/turns/list",
  "thread/items/list",
  "thread/name/set",
  "thread/archive",
  "thread/unarchive",
  "thread/delete",
  "thread/fork",
  "thread/revert",
  "thread/rollback",
]);
