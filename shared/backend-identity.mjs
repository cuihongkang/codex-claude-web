// 默认 Codex 实例沿用历史键，其他实例使用带版本前缀的可逆标识。
export function resourceId(backendId, nativeId) {
  if (nativeId == null || nativeId === "") return nativeId;
  if (backendId === "codex") return nativeId;
  return `backend:${encodeURIComponent(backendId)}:${encodeURIComponent(String(nativeId))}`;
}

export function resourceTarget(id, fallback = "codex") {
  if (typeof id !== "string" || !id.startsWith("backend:"))
    return { backendId: fallback, nativeId: id };
  const match = /^backend:([^:]+):(.+)$/.exec(id);
  if (!match) throw new Error("资源标识无效");
  return {
    backendId: decodeURIComponent(match[1]),
    nativeId: decodeURIComponent(match[2]),
  };
}
