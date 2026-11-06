import { spawn } from "node-pty";
import { userInfo } from "node:os";
export function createTerminals(broadcast) {
  const tasks = new Map();
  const emit = (method, params) => broadcast({ method, params });
  const snapshot = () =>
    Object.fromEntries(
      [...tasks].map(([id, t]) => [
        id,
        { buffer: t.buffer, running: t.running },
      ]),
    );
  return {
    snapshot,
    async request(method, p) {
      if (method === "command/exec") {
        if (!p.processId || tasks.has(p.processId))
          throw new Error("终端标识已被使用");
        const shell = process.env.SHELL || userInfo().shell || "/bin/sh";
        if (
          p.command &&
          (!Array.isArray(p.command) ||
            !p.command.length ||
            p.command.some((part) => typeof part !== "string"))
        )
          throw new Error("终端命令必须是参数数组");
        const command = p.command || [shell, "-l"];
        const child = spawn(command[0], command.slice(1), {
          cwd: p.cwd,
          env: { ...process.env, ...p.env },
          cols: p.size?.cols || 80,
          rows: p.size?.rows || 24,
          name: "xterm-256color",
        });
        const task = { child, buffer: "", running: true };
        tasks.set(p.processId, task);
        emit("lan/terminalStarted", { processId: p.processId });
        child.onData((text) => {
          task.buffer = (task.buffer + text).slice(-200000);
          emit("command/exec/outputDelta", {
            processId: p.processId,
            deltaBase64: Buffer.from(text).toString("base64"),
          });
        });
        return new Promise((resolve) =>
          child.onExit(({ exitCode }) => {
            task.running = false;
            emit("lan/terminalExit", { processId: p.processId, exitCode });
            resolve({ exitCode, stdout: "", stderr: "" });
          }),
        );
      }
      const task = tasks.get(p.processId);
      if (!task?.running) throw new Error("终端已结束");
      if (method === "command/exec/write")
        task.child.write(Buffer.from(p.deltaBase64, "base64").toString());
      else if (method === "command/exec/resize")
        task.child.resize(Math.max(1, p.size.cols), Math.max(1, p.size.rows));
      else if (method === "command/exec/terminate") task.child.kill();
      else throw new Error(`不支持的方法：${method}`);
      return {};
    },
    close() {
      for (const task of tasks.values()) if (task.running) task.child.kill();
    },
  };
}
