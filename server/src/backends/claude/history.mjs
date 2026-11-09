import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { claudeRuntimeEnvironment } from "./provider-environment.mjs";

// 会话 API 在独立进程中读取实例目录，避免 SDK 的全局环境缓存串用数据。
export function createSessionReader(backend) {
  return (operation, ...args) =>
    new Promise((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [fileURLToPath(new URL("./session-worker.mjs", import.meta.url))],
        {
          env: claudeRuntimeEnvironment(backend),
          stdio: ["pipe", "pipe", "pipe"],
        },
      );
      let output = "",
        stderr = "",
        settled = false;
      const timer = setTimeout(() => {
        child.kill();
        finish(new Error("读取 Claude 历史超时"));
      }, 30000);
      function finish(error, value) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) reject(error);
        else resolve(value);
      }
      child.on("error", (error) => finish(error));
      child.stdout.on("data", (chunk) => {
        output += chunk;
      });
      child.stderr.on("data", (chunk) => {
        stderr = (stderr + chunk).slice(-4000);
      });
      child.stdin.on("error", () => {});
      child.on("close", (code) => {
        if (settled) return;
        try {
          if (code !== 0) throw new Error(stderr || "读取 Claude 历史失败");
          const message = JSON.parse(output);
          if (message.error) throw new Error(message.error);
          finish(null, message.result);
        } catch (error) {
          finish(error);
        }
      });
      child.stdin.end(JSON.stringify({ operation, args }));
    });
}

export function page(records, params) {
  const values =
    params.sortDirection === "asc" ? records : records.toReversed();
  const offset = Number(params.cursor || 0),
    limit = Math.min(100, Math.max(1, Number(params.limit) || 100));
  if (!Number.isSafeInteger(offset) || offset < 0)
    throw new Error("分页位置无效");
  return {
    data: values.slice(offset, offset + limit),
    nextCursor: offset + limit < values.length ? String(offset + limit) : null,
  };
}
