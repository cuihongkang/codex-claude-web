import { isCompacting } from "./compaction-state.mjs";

// 后端快照包含原生执行与网页占用；停止前仍须在执行方原子复核。
export function hasBackendWork(state = {}) {
  return Boolean(
    Object.keys(state.activeTurns || {}).length ||
    Object.keys(state.backgroundTasks || {}).length ||
    Object.keys(state.queuedInputs || {}).length ||
    state.internalCommands?.length ||
    state.questions?.length ||
    Object.values(state.compactions || {}).some(isCompacting),
  );
}
