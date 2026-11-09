const writes = new Set([
  "thread/revert",
  "thread/rollback",
  "turn/start",
  "turn/steer",
  "thread/compact/start",
  "review/start",
]);
const fileWrites = new Set([
  ...writes,
  "thread/goal/get",
  "thread/goal/set",
  "thread/goal/clear",
  "thread/backgroundTerminals/list",
  "thread/backgroundTerminals/clean",
]);

// 只读取执行方提供的即时占用；原生订阅、队列与变更锁继续由执行方持有。
export function assertConversationOperation(
  method,
  { compacting, undoing, active, pending },
) {
  if (writes.has(method) && compacting)
    throw new Error("正在整理上下文，完成后可继续发送。");
  if (method === "thread/compact/start" && (active || pending))
    throw new Error("请等待当前任务结束后整理上下文。");
  if (fileWrites.has(method) && undoing)
    throw new Error("正在撤销文件修改，完成后可继续发送。");
}
