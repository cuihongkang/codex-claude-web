import { execFileSync } from "node:child_process";
import WebSocket from "ws";
import { readConfig } from "../server/src/config.mjs";
import { isCompacting } from "../server/src/compaction.mjs";

const config = readConfig();
const origin = `http://127.0.0.1:${config.port}`;
const url = origin.replace("http:", "ws:") + "/rpc";
let timer,
  restarting = false;
function connect() {
  const socket = new WebSocket(url);
  let ready = false;
  const turns = new Map(),
    compactions = new Map();
  let lastStatus;
  function check() {
    if (restarting) return;
    const status = `等待空闲：${turns.size} 个任务，${compactions.size} 个上下文整理${ready ? "。" : "，正在连接。"}`;
    if (status !== lastStatus) {
      console.log(status);
      lastStatus = status;
    }
    if (!ready || turns.size || compactions.size) {
      clearTimeout(timer);
      timer = undefined;
      return;
    }
    if (timer) return;
    timer = setTimeout(async () => {
      try {
        const before = await fetch(origin + "/healthz", {
          signal: AbortSignal.timeout(5000),
        }).then((r) => r.json());
        if (before.claude?.busy || !ready || turns.size || compactions.size) {
          console.log("等待 Claude 任务完成后重启。");
          timer = undefined;
          setTimeout(check, 2000);
          return;
        }
        restarting = true;
        execFileSync(
          "systemctl",
          ["--user", "restart", "codex-lan-web.service"],
          { stdio: "inherit" },
        );
        for (let attempt = 0; attempt < 30; attempt++) {
          const health = await fetch(origin + "/healthz", {
            signal: AbortSignal.timeout(5000),
          })
            .then((response) => response.json())
            .catch(() => null);
          if (health?.ready) {
            console.log(
              `网页服务已重启并通过健康检查，运行版本：${health.version?.displayVersion || "未知"}。`,
            );
            return;
          }
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
        throw new Error("网页服务已执行重启，健康检查等待超时。");
      } catch (error) {
        restarting = true;
        console.error(error.message);
        process.exitCode = 1;
      } finally {
        if (restarting) socket.close();
      }
    }, 2000);
  }
  socket.on("message", (bytes) => {
    const { method, params: p = {} } = JSON.parse(bytes);
    if (
      ![
        "lan/state",
        "lan/compaction",
        "turn/started",
        "turn/completed",
      ].includes(method)
    )
      return;
    if (method === "lan/state") {
      ready = p.ready;
      turns.clear();
      for (const [threadId, turnId] of Object.entries(p.activeTurns))
        turns.set(threadId, turnId);
      compactions.clear();
      for (const [id, entry] of Object.entries(p.compactions || {}))
        if (isCompacting(entry)) compactions.set(id, entry);
    }
    if (method === "lan/compaction") {
      if (isCompacting(p.compaction)) compactions.set(p.threadId, p.compaction);
      else compactions.delete(p.threadId);
    }
    if (method === "turn/started") turns.set(p.threadId, p.turn.id);
    if (method === "turn/completed" && turns.get(p.threadId) === p.turn.id)
      turns.delete(p.threadId);
    check();
  });
  socket.on("error", (error) => console.error(error.message));
  socket.on("close", () => {
    clearTimeout(timer);
    timer = undefined;
    if (!restarting) setTimeout(connect, 2000);
  });
}
connect();
