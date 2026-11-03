import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

const messages = {
  completed: "任务已完成",
  failed: "任务失败",
  attention: "需要你确认或回答",
};
export function createNtfy({
  url = process.env.NTFY_URL || "",
  token = process.env.NTFY_TOKEN || "",
  webUrl = process.env.NTFY_WEB_URL || "",
  stateFile = join(
    process.env.XDG_STATE_HOME || join(homedir(), ".local/state"),
    "codex-web/ntfy.json",
  ),
  fetchImpl = fetch,
  retryMs = 5000,
  onError = (message) => console.error("ntfy:", message),
} = {}) {
  const enabled = !!url;
  let endpoint;
  if (enabled) {
    endpoint = new URL(url);
    if (
      endpoint.protocol !== "https:" ||
      !/^\/[A-Za-z0-9_-]+$/.test(endpoint.pathname) ||
      endpoint.search ||
      endpoint.hash ||
      endpoint.username ||
      endpoint.password
    )
      throw Error("NTFY_URL 必须是 HTTPS 服务地址和单个主题名称");
  }
  const pending = new Map(),
    seen = new Set();
  let saving = Promise.resolve(),
    running = false,
    timer,
    closed = false;
  const save = () => {
    const data = JSON.stringify({
      seen: [...seen].slice(-1000),
      pending: [...pending],
    });
    saving = saving
      .catch(() => {})
      .then(async () => {
        await mkdir(dirname(stateFile), { recursive: true, mode: 0o700 });
        await writeFile(stateFile + ".tmp", data, { mode: 0o600 });
        await rename(stateFile + ".tmp", stateFile);
      });
    return saving;
  };
  const ready = enabled
    ? readFile(stateFile, "utf8")
        .then((raw) => {
          const data = JSON.parse(raw);
          for (const key of data.seen || []) seen.add(key);
          for (const [key, item] of data.pending || []) pending.set(key, item);
        })
        .catch((error) => {
          if (error.code !== "ENOENT") onError("无法读取推送队列");
        })
    : Promise.resolve();
  function schedule() {
    if (closed || timer || !pending.size) return;
    timer = setTimeout(() => {
      timer = null;
      void flush();
    }, retryMs);
    timer.unref?.();
  }
  async function flush() {
    await ready;
    if (running || closed || !enabled) return;
    running = true;
    try {
      for (const [key, item] of pending) {
        if (closed) break;
        if (Date.now() - item.createdAt > 86400000) {
          pending.delete(key);
          await save();
          continue;
        }
        const e = item.event;
        const name = e.provider === "claude" ? "Claude" : "Codex";
        let click;
        if (webUrl) {
          const target = new URL(webUrl);
          target.searchParams.set("notifyProvider", e.provider);
          target.searchParams.set("notifyThread", e.threadId);
          click = target.href;
        }
        try {
          const response = await fetchImpl(endpoint.origin, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: JSON.stringify({
              topic: endpoint.pathname.slice(1),
              title: `${name} · ${messages[e.kind]}`,
              message: "电脑上的会话有新状态，点击查看。",
              tags: [
                e.kind === "failed"
                  ? "warning"
                  : e.kind === "attention"
                    ? "question"
                    : "white_check_mark",
              ],
              priority: e.kind === "attention" ? 4 : 3,
              ...(click ? { click } : {}),
            }),
            signal: AbortSignal.timeout(15000),
          });
          if (!response.ok) throw Error(`HTTP ${response.status}`);
          pending.delete(key);
          await save();
        } catch {
          onError("发送失败，稍后自动重试");
          break;
        }
      }
    } catch {
      onError("保存推送队列失败");
    } finally {
      running = false;
      schedule();
    }
  }
  async function publish(event) {
    if (
      !enabled ||
      !messages[event?.kind] ||
      !event.threadId ||
      !event.id ||
      !["codex", "claude"].includes(event.provider)
    )
      return;
    await ready;
    const key = JSON.stringify([
      event.provider,
      event.threadId,
      event.kind,
      event.id,
    ]);
    if (seen.has(key)) return;
    seen.add(key);
    if (seen.size > 1000) seen.delete(seen.values().next().value);
    // Persist only routing metadata, never conversation text or tool output.
    pending.set(key, {
      createdAt: Date.now(),
      event: {
        provider: event.provider,
        threadId: event.threadId,
        kind: event.kind,
        id: event.id,
      },
    });
    await save();
    void flush();
  }
  ready.then(() => {
    if (pending.size) void flush();
  });
  return {
    enabled,
    publish: (event) => publish(event).catch(() => onError("保存推送队列失败")),
    flush,
    close: async () => {
      closed = true;
      clearTimeout(timer);
      await saving;
    },
  };
}
