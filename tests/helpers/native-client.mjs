import WebSocket from "ws";
import { once } from "node:events";

export async function nativeClient(url) {
  const socket = new WebSocket(url);
  await once(socket, "open");
  let sequence = 0;
  const pending = new Map();
  const events = [];
  socket.on("message", (raw) => {
    const message = JSON.parse(raw);
    if (message.method) events.push(message);
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    clearTimeout(entry.timer);
    if (message.error) entry.reject(new Error(message.error.message));
    else entry.resolve(message.result);
  });
  const call = (method, params) =>
    new Promise((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(
        () => reject(new Error("Native RPC timeout: " + method)),
        30000,
      );
      pending.set(id, { resolve, reject, timer });
      socket.send(JSON.stringify({ id, method, params }));
    });
  await call("initialize", {
    clientInfo: { name: "isolated_native_verification", version: "1" },
    capabilities: { experimentalApi: true },
  });
  socket.send(JSON.stringify({ method: "initialized" }));
  return {
    call,
    events,
    close() {
      for (const entry of pending.values()) {
        clearTimeout(entry.timer);
        entry.reject(new Error("Native client closed"));
      }
      pending.clear();
      socket.terminate();
    },
  };
}
