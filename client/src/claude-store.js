import { useSyncExternalStore } from "react";
import { readClaudeCache, writeClaudeCache } from "./claude-cache.js";
const listeners = new Set(),
  pending = new Map();
function saved(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}
function persist(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}
const cached = readClaudeCache();
const selectedId = saved("claude-selected", null);
const restored = cached?.selected === selectedId ? cached : null;
let cacheTimer, draftTimer;
let liveHistory = null;
let state = {
  connected: false,
  sessions: cached?.sessions || [],
  next: null,
  selected: selectedId,
  session: restored?.session || null,
  messages: restored?.messages || [],
  permissions: [],
  loading: false,
  sending: false,
  error: "",
  defaultCwd: "",
  drafts: saved("claude-drafts", {}),
  query: "",
};
let socket,
  seq = 0,
  epoch = 0,
  listEpoch = 0;
const update = (patch) => {
  state = { ...state, ...patch };
  for (const fn of listeners) fn();
  if (
    patch.messages ||
    patch.sessions ||
    patch.session ||
    "selected" in patch
  ) {
    if (!cacheTimer) cacheTimer = setTimeout(flushCache, 500);
  }
};
function flushCache() {
  clearTimeout(cacheTimer);
  cacheTimer = null;
  writeClaudeCache(state);
}
function flushDrafts() {
  clearTimeout(draftTimer);
  draftTimer = null;
  persist("claude-drafts", state.drafts);
}
function flushSavedState() {
  flushDrafts();
  flushCache();
}
window.addEventListener("pagehide", flushSavedState);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") flushSavedState();
});
export function useClaude() {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => state,
  );
}
export function claudeState() {
  return state;
}
export function setClaudeDraft(id, text) {
  const drafts = { ...state.drafts, [id || "new"]: text };
  update({ drafts });
  // Keep send/switch synchronous in memory; batch disk writes after typing stops.
  clearTimeout(draftTimer);
  draftTimer = setTimeout(flushDrafts, 300);
}
export function claudeError(error) {
  update({ error: error?.message || String(error || "") });
}
export function claudeRpc(method, params = {}) {
  return new Promise((resolve, reject) => {
    if (socket?.readyState !== WebSocket.OPEN)
      return reject(Error("Claude 尚未连接，正在重连。"));
    const id = ++seq,
      timer = setTimeout(() => {
        pending.delete(id);
        reject(Error("请求超时，请刷新会话确认任务状态。"));
      }, 90000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
function mergeMessages(old, added, removed = []) {
  const map = new Map(old.map((m) => [m.id, m]));
  for (const id of removed) map.delete(id);
  for (const m of added)
    map.set(m.id, { ...m, kind: m.kind || map.get(m.id)?.kind });
  return [...map.values()];
}
export async function loadClaude(more = false, query = state.query) {
  const revision = ++listEpoch,
    r = await claudeRpc("list", { offset: more ? state.next || 0 : 0, query });
  if (revision !== listEpoch) return;
  const sessions = more
    ? [
        ...state.sessions,
        ...r.sessions.filter((s) => !state.sessions.some((p) => p.id === s.id)),
      ]
    : r.sessions;
  const selected = sessions.find((s) => s.id === state.selected);
  update({
    sessions,
    next: r.next,
    defaultCwd: r.defaultCwd,
    query,
    ...(selected ? { session: { ...state.session, ...selected } } : {}),
  });
}
export async function retryClaude(id = state.selected) {
  if (!id) return;
  const revision = epoch;
  try {
    const r = await claudeRpc("status", { id });
    if (revision !== epoch || id !== state.selected) return;
    update({
      session: r.session,
      permissions: r.permissions,
      messages: mergeMessages(
        state.messages,
        r.messages || [],
        r.removed || [],
      ),
      error: "",
    });
  } catch (e) {
    if (revision === epoch) claudeError(e);
  }
}
export async function openClaude(id, refresh = false) {
  if (id && id === state.selected && state.session && !refresh)
    return retryClaude(id);
  const preserve = id && id === state.selected;
  const revision = ++epoch;
  liveHistory = { revision, messages: [], removed: new Set() };
  persist("claude-selected", id);
  update({
    selected: id,
    session:
      (preserve ? state.session : null) ||
      state.sessions.find((s) => s.id === id) ||
      null,
    messages: preserve ? state.messages : [],
    permissions: preserve ? state.permissions : [],
    loading: !!id && (!preserve || !state.messages.length),
    error: "",
  });
  if (!id) return;
  try {
    let offset = 0;
    let history = [];
    do {
      const r = await claudeRpc("open", { id, offset });
      if (epoch !== revision) return;
      history = mergeMessages(history, r.messages);
      // Keep the cached tail in place until all older pages are available.
      // Appending those pages to the tail would put old messages at the bottom.
      if (r.next === null)
        update({
          session: r.session,
          messages: mergeMessages(history, liveHistory.messages, [
            ...liveHistory.removed,
          ]),
          permissions: r.permissions,
        });
      offset = r.next;
    } while (offset !== null);
  } catch (e) {
    if (epoch === revision) claudeError(e);
  } finally {
    if (epoch === revision) {
      liveHistory = null;
      update({ loading: false });
    }
  }
}
export async function sendClaude({ cwd, model, effort } = {}) {
  if (state.sending) return;
  const originalId = state.selected,
    text = state.drafts[originalId || "new"] || "",
    revision = epoch;
  if (!text.trim()) return;
  update({ sending: true, error: "" });
  try {
    let id = originalId;
    if (!id) {
      const r = await claudeRpc("create", {
        cwd: cwd || state.defaultCwd,
        model,
        effort,
      });
      id = r.session.id;
      if (epoch === revision) {
        setClaudeDraft(id, text);
        await openClaude(id);
      }
    }
    await claudeRpc("send", {
      id,
      text,
      messageId: crypto.randomUUID ? crypto.randomUUID() : uuid(),
    });
    if (state.drafts[originalId || "new"] === text)
      setClaudeDraft(originalId, "");
    if (id !== originalId && state.drafts[id] === text) setClaudeDraft(id, "");
    await loadClaude();
  } catch (e) {
    claudeError(e);
  } finally {
    update({ sending: false });
  }
}
// randomUUID is unavailable on HTTP LAN origins; getRandomValues remains available.
function uuid() {
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 15) | 64;
  b[8] = (b[8] & 63) | 128;
  const h = [...b].map((v) => v.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
function connect() {
  const ws = new WebSocket(
    `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/claude/rpc`,
  );
  socket = ws;
  ws.onmessage = ({ data }) => {
    if (socket !== ws) return;
    const m = JSON.parse(data);
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id);
      clearTimeout(p.timer);
      pending.delete(m.id);
      m.error ? p.reject(Error(m.error.message)) : p.resolve(m.result);
      return;
    }
    if (m.method === "claude/ready") {
      update({ connected: true });
      loadClaude().catch(claudeError);
      if (state.selected) openClaude(state.selected, true);
      return;
    }
    if (m.method === "claude/listChanged") {
      loadClaude().catch(claudeError);
      return;
    }
    if (m.method === "claude/session") {
      const p = m.params;
      if (p.session.id === state.selected) {
        if (liveHistory) {
          liveHistory.messages = mergeMessages(
            liveHistory.messages,
            p.messages,
            p.removed,
          );
          for (const id of p.removed || []) liveHistory.removed.add(id);
          for (const m of p.messages || []) liveHistory.removed.delete(m.id);
        }
        update({
          session: p.session,
          messages: mergeMessages(state.messages, p.messages, p.removed),
          permissions: p.permissions,
        });
      }
    }
  };
  ws.onclose = () => {
    if (socket !== ws) return;
    update({ connected: false });
    for (const p of pending.values()) {
      clearTimeout(p.timer);
      p.reject(Error("连接已断开；后台任务继续运行，重连后会恢复。"));
    }
    pending.clear();
    setTimeout(connect, 2000);
  };
  ws.onerror = () => {};
}
connect();
setInterval(() => {
  if (state.connected) loadClaude().catch(() => {});
}, 15000);
window.addEventListener("focus", () => {
  if (state.connected) {
    loadClaude().catch(() => {});
    if (state.selected) retryClaude(state.selected);
  }
});
