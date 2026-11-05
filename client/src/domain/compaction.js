import { isCompacting } from "../../../shared/compaction-state.mjs";

export {
  isCompacting,
  recoverCompaction,
} from "../../../shared/compaction-state.mjs";

// 已结束的桥接记录仅更新页面正在跟踪的同一任务，避免恢复已收起的提示。
export function mergeCompactions(current, incoming = {}) {
  const entries = { ...current };
  for (const [threadId, entry] of Object.entries(incoming)) {
    const previous = current[threadId];
    if (
      isCompacting(entry) ||
      (previous &&
        (previous.id === entry.id ||
          (previous.turnId && previous.turnId === entry.turnId)))
    )
      entries[threadId] = entry;
  }
  return entries;
}
