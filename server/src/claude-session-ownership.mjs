import { externalOwner } from "./claude-history.mjs";
import { findSharedBridge } from "./claude-shared-client.mjs";
import {
  mkdirSync,
  openSync,
  closeSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  statSync,
} from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

function startTime(pid) {
  try {
    return readFileSync(`/proc/${pid}/stat`, "utf8")
      .split(") ")[1]
      .split(" ")[19];
  } catch {
    return null;
  }
}
// Shared by the SDK worker and the legacy CLI workspace. The native session,
// not the UI thread alias, owns the reservation until its process has exited.
export function claimClaudeSession(home, id) {
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error("无效的 Claude 会话标识");
  const dir = join(home, "web-session-owners");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, `${id}.json`);
  const token = randomUUID();
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(path, "wx", 0o600);
      try {
        writeFileSync(
          fd,
          JSON.stringify({
            pid: process.pid,
            start: startTime(process.pid),
            token,
          }),
        );
      } finally {
        closeSync(fd);
      }
      return () => {
        try {
          if (JSON.parse(readFileSync(path, "utf8")).token === token)
            unlinkSync(path);
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
        }
      };
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      let stale = false;
      const before = statSync(path);
      try {
        const owner = JSON.parse(readFileSync(path, "utf8"));
        try {
          process.kill(owner.pid, 0);
          stale = owner.start !== startTime(owner.pid);
        } catch (error) {
          stale = error.code === "ESRCH";
        }
      } catch {
        /* An in-progress or malformed reservation stays protected. */
      }
      if (!stale) break;
      try {
        if (statSync(path).ino === before.ino) unlinkSync(path);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
  }
  throw new Error(
    "此 Claude 会话已由另一个网页入口持有，请在原入口继续，或先释放会话后重试。",
  );
}

export async function reserveClaudeSession(home, id) {
  if (await findSharedBridge(home, id))
    throw new Error(
      "此会话正在 VS Code 插件中运行，请使用侧栏的 Claude 插件会话入口继续。",
    );
  if (await externalOwner(home, id))
    throw new Error("此会话仍由其他 Claude 进程持有，请先关闭原会话后重试。");
  return claimClaudeSession(home, id);
}
