import net from "node:net";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { EventEmitter } from "node:events";
export const bridgeDirectory = (home) => join(home, "web-bridges");
export async function findSharedBridge(home, id) {
  let entries;
  try {
    entries = await readdir(bridgeDirectory(home));
  } catch (e) {
    if (e.code === "ENOENT") return null;
    throw e;
  }
  for (const name of entries) {
    if (!/^\d+\.json$/.test(name)) continue;
    try {
      const r = JSON.parse(
        await readFile(join(bridgeDirectory(home), name), "utf8"),
      );
      if (r.sessionId !== id || !r.ready || !Number.isSafeInteger(r.pid))
        continue;
      process.kill(r.pid, 0);
      return { ...r, socketPath: join(bridgeDirectory(home), r.pid + ".sock") };
    } catch {}
  }
  return null;
}
export async function connectSharedBridge(record, onEvent) {
  const socket = net.createConnection(record.socketPath),
    child = new EventEmitter();
  child.pid = record.childPid;
  child.shared = true;
  let buffer = "",
    resolveReady,
    rejectReady;
  const ready = new Promise((r, j) => {
    resolveReady = r;
    rejectReady = j;
  });
  const timer = setTimeout(() => {
    socket.destroy();
    rejectReady(Error("插件共享连接超时"));
  }, 5000);
  child.stdin = {
    write(line) {
      if (socket.destroyed) throw Error("插件共享连接已关闭");
      socket.write(
        JSON.stringify({ method: "write", message: JSON.parse(line) }) + "\n",
      );
    },
    end() {
      socket.end();
    },
    get destroyed() {
      return socket.destroyed;
    },
  };
  child.kill = () => socket.destroy();
  socket.on("connect", () =>
    socket.write(JSON.stringify({ method: "snapshot" }) + "\n"),
  );
  socket.on("data", (chunk) => {
    buffer += chunk;
    let i;
    while ((i = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, i);
      buffer = buffer.slice(i + 1);
      let m;
      try {
        m = JSON.parse(line);
      } catch {
        continue;
      }
      if (m.type === "snapshot") {
        clearTimeout(timer);
        resolveReady({ child, snapshot: m });
      } else if (m.type === "event") onEvent(m.message);
      else if (m.type === "error") child.emit("bridgeError", Error(m.message));
    }
  });
  socket.on("error", (e) => {
    clearTimeout(timer);
    rejectReady(e);
    child.emit("bridgeError", e);
  });
  socket.on("close", () => {
    clearTimeout(timer);
    rejectReady(Error("插件共享连接已关闭"));
    child.emit("close", 0);
  });
  return ready;
}
