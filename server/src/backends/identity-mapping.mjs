import {
  resourceId,
  resourceTarget,
} from "../../../shared/backend-identity.mjs";

const threadFields = new Set([
  "threadId",
  "parentThreadId",
  "forkedFromId",
  "senderThreadId",
  "receiverThreadId",
  "agentId",
  "agentThreadId",
]);
const opaque = new Set([
  "arguments",
  "input",
  "content",
  "output",
  "config",
  "metadata",
  "result",
]);

export function mapResult(value, backendId, method, context = "") {
  if (backendId === "codex") return value;
  const key = (id) => resourceId(backendId, id);
  if (Array.isArray(value))
    return value.map((entry) => mapResult(entry, backendId, method, context));
  if (!value || typeof value !== "object") return value;
  const result = {};
  for (const [name, entry] of Object.entries(value)) {
    if (threadFields.has(name) || name === "processId" || name === "requestId")
      result[name] = key(entry);
    else if (name === "receiverThreadIds") result[name] = entry.map(key);
    else if (name === "id" && ["thread", "question"].includes(context))
      result[name] = key(entry);
    else if (opaque.has(name)) result[name] = entry;
    else
      result[name] = mapResult(
        entry,
        backendId,
        method,
        name === "data" && method === "thread/list"
          ? "thread"
          : name === "thread"
            ? "thread"
            : name,
      );
  }
  if (context === "thread") result.backendId = backendId;
  return result;
}

export function nativeParams(params, backendId) {
  const result = { ...params };
  delete result.backendId;
  for (const name of ["threadId", "processId"]) {
    if (result[name] == null) continue;
    const target = resourceTarget(result[name], backendId);
    if (target.backendId !== backendId) throw new Error("资源与后端不匹配");
    result[name] = target.nativeId;
  }
  return result;
}

export function mapState(state, backendId) {
  const key = (id) => resourceId(backendId, id);
  const keyed = (entries) =>
    Object.fromEntries(
      Object.entries(entries || {}).map(([id, value]) => [key(id), value]),
    );
  return {
    activeTurns: keyed(state.activeTurns),
    executionStatuses: keyed(state.executionStatuses),
    compactions: keyed(state.compactions),
    terminals: keyed(state.terminals),
    questions: (state.questions || []).map((q) => ({
      ...q,
      id: key(q.id),
      params: mapResult(q.params, backendId, q.method),
    })),
    undoneFiles: (state.undoneFiles || []).map((f) =>
      mapResult(f, backendId, ""),
    ),
  };
}
