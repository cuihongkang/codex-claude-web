#!/usr/bin/env node
// VS Code's supported claudeProcessWrapper passes its bundled executable first.
import { spawn } from "node:child_process";
import net from "node:net";
import { mkdir, writeFile, rename, chmod, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { join, isAbsolute } from "node:path";
import { createInterface } from "node:readline";
import { bridgeDirectory } from "../server/src/claude-shared-client.mjs";
import { transcriptMessage } from "../server/src/claude-history.mjs";
const [executable, ...args] = process.argv.slice(2);
if (!executable || !isAbsolute(executable)) {
  console.error("Usage: claude-shared /absolute/path/to/claude [arguments]");
  process.exit(2);
}
const streaming = args.some(
  (v, i) =>
    v === "--input-format=stream-json" ||
    (v === "--input-format" && args[i + 1] === "stream-json"),
);
const child = spawn(executable, args, {
  stdio: streaming ? ["pipe", "pipe", "inherit"] : "inherit",
  env: process.env,
  cwd: process.cwd(),
});
if (!streaming) {
  child.on("error", (e) => {
    console.error(e.message);
    process.exit(1);
  });
  child.on("exit", (code) => process.exit(code ?? 1));
  for (const signal of ["SIGTERM", "SIGINT"])
    process.on(signal, () => child.kill(signal));
} else {
  const root = bridgeDirectory(
    process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude"),
  );
  await mkdir(root, { recursive: true, mode: 0o700 });
  await chmod(root, 0o700);
  const socketPath = join(root, process.pid + ".sock"),
    recordPath = join(root, process.pid + ".json");
  const clients = new Set(),
    messages = new Map(),
    permissions = new Map(),
    controls = new Map(),
    answered = new Set();
  let sessionId = args[args.indexOf("--resume") + 1] || "",
    status = "starting",
    ready = false,
    partial = null,
    writeChain = Promise.resolve(),
    ended = false,
    initializeId = null,
    lastRegistry = "";
  if (!args.includes("--resume"))
    sessionId = args.includes("--session-id")
      ? args[args.indexOf("--session-id") + 1]
      : "";
  const host = (m) => {
    if (!process.stdout.destroyed)
      process.stdout.write(JSON.stringify(m) + "\n");
  };
  const send = (s, m) => {
    if (!s.destroyed) s.write(JSON.stringify(m) + "\n");
  };
  const publish = (m) => {
    for (const s of clients) send(s, { type: "event", message: m });
  };
  function persist() {
    const data = JSON.stringify({
      pid: process.pid,
      childPid: child.pid,
      sessionId,
      cwd: process.cwd(),
      ready,
      status,
    });
    if (data === lastRegistry) return;
    lastRegistry = data;
    writeChain = writeChain
      .catch(() => {})
      .then(async () => {
        if (ended) return;
        await writeFile(recordPath + ".tmp", data, { mode: 0o600 });
        await rename(recordPath + ".tmp", recordPath);
      })
      .catch((e) => console.error("Claude sharing registry:", e.message));
  }
  function observe(m) {
    if (m.session_id && !m.parent_tool_use_id) {
      sessionId = m.session_id;
      persist();
    }
    const message = transcriptMessage(m);
    if (message?.id) messages.set(message.id, message);
    if (m.type === "user") {
      status = "running";
      persist();
    }
    if (m.type === "result") {
      status = m.is_error ? "error" : "idle";
      permissions.clear();
      partial = null;
      persist();
    }
    if (m.type === "control_request" && m.request?.subtype === "can_use_tool")
      permissions.set(m.request_id, {
        id: m.request_id,
        tool: m.request.tool_name,
        input: m.request.input,
      });
    if (m.type === "control_cancel_request") permissions.delete(m.request_id);
    if (m.type === "stream_event") {
      const e = m.event;
      if (e.type === "message_start") {
        status = "running";
        partial = {
          id: "partial:" + e.message.id,
          role: "assistant",
          partial: true,
          content: [],
        };
        persist();
      }
      if (e.type === "content_block_start" && partial)
        partial.content[e.index] = { ...e.content_block };
      if (e.type === "content_block_delta" && partial) {
        const c = partial.content[e.index];
        if (c && e.delta.type === "text_delta")
          c.text = (c.text || "") + e.delta.text;
        if (c && e.delta.type === "thinking_delta")
          c.thinking = (c.thinking || "") + e.delta.thinking;
      }
    }
    if (m.type === "assistant") partial = null;
  }
  function cancelPermission(id) {
    permissions.delete(id);
    answered.add(id);
    const cancel = { type: "control_cancel_request", request_id: id };
    host(cancel);
    publish(cancel);
  }
  function input(m, origin) {
    if (
      !origin &&
      m.type === "control_request" &&
      m.request?.subtype === "initialize"
    )
      initializeId = m.request_id;
    if (origin) {
      if (
        m.type === "control_request" &&
        ["set_model", "apply_flag_settings"].includes(m.request?.subtype) &&
        status !== "idle"
      ) {
        send(origin, {
          type: "event",
          message: {
            type: "control_response",
            response: {
              subtype: "error",
              request_id: m.request_id,
              error: "请等待插件当前任务完成后修改设置",
            },
          },
        });
        return;
      }
      const allowed =
        m.type === "user" ||
        (m.type === "control_request" &&
          [
            "interrupt",
            "set_model",
            "apply_flag_settings",
            "get_settings",
          ].includes(m.request?.subtype)) ||
        (m.type === "control_response" &&
          permissions.has(m.response?.request_id));
      if (!allowed) {
        send(origin, { type: "error", message: "不支持的共享操作" });
        return;
      }
      if (m.type === "control_request") controls.set(m.request_id, origin);
    }
    if (m.type === "control_response") {
      const id = m.response?.request_id;
      if (answered.has(id)) return;
      if (permissions.has(id)) {
        child.stdin.write(JSON.stringify(m) + "\n");
        cancelPermission(id);
        return;
      }
    }
    if (m.type === "user") {
      if (origin && messages.has(m.uuid)) return;
      observe(m);
      publish(m); // The CLI replay also delivers browser input to the VS Code host.
    }
    child.stdin.write(JSON.stringify(m) + "\n");
  }
  createInterface({ input: process.stdin, crlfDelay: Infinity })
    .on("line", (line) => {
      try {
        input(JSON.parse(line), null);
      } catch (e) {
        console.error("Claude sharing input:", e.message);
      }
    })
    .on("close", () => child.stdin.end());
  child.stdin.on("error", () => {});
  process.stdout.on("error", () => child.kill("SIGTERM"));
  createInterface({ input: child.stdout, crlfDelay: Infinity }).on(
    "line",
    (line) => {
      let m;
      try {
        m = JSON.parse(line);
      } catch {
        process.stdout.write(line + "\n");
        return;
      }
      if (
        m.type === "control_response" &&
        controls.has(m.response?.request_id)
      ) {
        const origin = controls.get(m.response.request_id);
        controls.delete(m.response.request_id);
        send(origin, { type: "event", message: m });
        return;
      }
      if (
        m.type === "control_response" &&
        m.response?.subtype === "success" &&
        m.response?.request_id === initializeId &&
        !ready
      ) {
        ready = true;
        status = "idle";
        persist();
      }
      observe(m);
      host(m);
      if (
        [
          "user",
          "assistant",
          "stream_event",
          "result",
          "control_cancel_request",
        ].includes(m.type) ||
        (m.type === "control_request" && m.request?.subtype === "can_use_tool")
      )
        publish(m);
    },
  );
  const server = net.createServer((socket) => {
    clients.add(socket);
    let buffer = "";
    socket.on("error", () => {});
    socket.on("close", () => clients.delete(socket));
    socket.on("data", (chunk) => {
      buffer += chunk;
      if (buffer.length > 2 * 1024 * 1024) {
        socket.destroy();
        return;
      }
      let i;
      while ((i = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, i);
        buffer = buffer.slice(i + 1);
        try {
          const m = JSON.parse(line);
          if (m.method === "snapshot")
            send(socket, {
              type: "snapshot",
              sessionId,
              status,
              messages: [...messages.values(), ...(partial ? [partial] : [])],
              permissions: [...permissions.values()],
            });
          else if (m.method === "write") input(m.message, socket);
        } catch (e) {
          send(socket, { type: "error", message: e.message });
        }
      }
    });
  });
  server.on("error", (e) => console.error("Claude sharing socket:", e.message));
  server.listen(socketPath, async () => {
    await chmod(socketPath, 0o600);
    persist();
  });
  async function cleanup(code) {
    if (ended) return;
    ended = true;
    for (const c of clients) c.destroy();
    server.close();
    await writeChain;
    await unlink(recordPath).catch(() => {});
    await unlink(socketPath).catch(() => {});
    process.exit(code ?? 1);
  }
  child.on("error", (e) => {
    console.error(e.message);
    cleanup(1);
  });
  child.on("close", (code) => cleanup(code));
  for (const signal of ["SIGTERM", "SIGINT"])
    process.on(signal, () => child.kill(signal));
}
