import { spawn } from "node-pty";
import { userInfo } from "node:os";
import { basename, resolve } from "node:path";

export function createTerminals(broadcast) {
  const tasks = new Map();
  let processTimer;
  const emit = (method, params) => broadcast({ method, params });
  const snapshot = () =>
    Object.fromEntries(
      [...tasks].map(([id, t]) => [
        id,
        {
          buffer: t.buffer,
          running: t.running,
          processName: t.processName,
          owner: t.owner,
          cwd: t.cwd,
        },
      ]),
    );
  function updateProcesses() {
    for (const [processId, task] of tasks) {
      if (!task.running) continue;
      const name = basename(task.child.process);
      if (name === task.processName) continue;
      task.processName = name;
      emit("lan/terminalUpdated", { processId, processName: name });
    }
    if (![...tasks.values()].some((task) => task.running)) {
      clearInterval(processTimer);
      processTimer = undefined;
    }
  }
  return {
    snapshot,
    async request(method, p) {
      const web = method.startsWith("lan/terminal/");
      if (method === "lan/terminal/create" || method === "command/exec") {
        if (!p.processId || tasks.has(p.processId))
          throw new Error("终端标识已被使用");
        const shell = process.env.SHELL || userInfo().shell || "/bin/sh";
        if (
          !web &&
          p.command &&
          (!Array.isArray(p.command) ||
            !p.command.length ||
            p.command.some((part) => typeof part !== "string"))
        )
          throw new Error("终端命令必须是参数数组");
        const command = web ? [shell, "-l"] : p.command || [shell, "-l"];
        const cwd = resolve(p.cwd || process.cwd());
        const child = spawn(command[0], command.slice(1), {
          cwd,
          env: web
            ? { ...process.env, TERM: "xterm-256color", COLORTERM: "truecolor" }
            : { ...process.env, ...p.env },
          cols: p.size?.cols || 80,
          rows: p.size?.rows || 24,
          name: "xterm-256color",
        });
        const task = {
          child,
          cwd,
          buffer: "",
          running: true,
          processName: basename(shell),
          owner: web ? "workspace" : undefined,
        };
        tasks.set(p.processId, task);
        emit("lan/terminalStarted", {
          processId: p.processId,
          processName: task.processName,
          owner: task.owner,
          cwd: task.cwd,
        });
        child.onData((text) => {
          task.buffer = (task.buffer + text).slice(-200000);
          emit(web ? "lan/terminalOutput" : "command/exec/outputDelta", {
            processId: p.processId,
            deltaBase64: Buffer.from(text).toString("base64"),
          });
        });
        const exited = new Promise((resolve) =>
          child.onExit(({ exitCode }) => {
            task.running = false;
            updateProcesses();
            emit("lan/terminalExit", { processId: p.processId, exitCode });
            resolve({ exitCode, stdout: "", stderr: "" });
          }),
        );
        if (!processTimer) {
          processTimer = setInterval(updateProcesses, 500);
          processTimer.unref();
        }
        return web
          ? { processId: p.processId, processName: task.processName }
          : exited;
      }
      const task = tasks.get(p.processId);
      if (!task?.running) throw new Error("终端已结束");
      if (method === "command/exec/write" || method === "lan/terminal/write")
        task.child.write(Buffer.from(p.deltaBase64, "base64").toString());
      else if (
        method === "command/exec/resize" ||
        method === "lan/terminal/resize"
      )
        task.child.resize(Math.max(1, p.size.cols), Math.max(1, p.size.rows));
      else if (
        method === "command/exec/terminate" ||
        method === "lan/terminal/terminate"
      )
        task.child.kill();
      else throw new Error(`不支持的方法：${method}`);
      return {};
    },
    close() {
      clearInterval(processTimer);
      for (const task of tasks.values()) if (task.running) task.child.kill();
    },
  };
}
