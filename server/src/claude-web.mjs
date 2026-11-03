import { WebSocketServer } from "ws";
import { ClaudeSessions } from "./claude-sessions.mjs";
import { sendRpcText } from "./rpc-transport.mjs";

export function attachClaude(server, config, options = {}) {
  const clients = new WebSocketServer({
    noServer: true,
    maxPayload: 1024 * 1024,
  });
  const send = (socket, message) =>
    sendRpcText(socket, JSON.stringify(message));
  const sessions = new ClaudeSessions({
    defaultCwd: config.defaultCwd,
    ...options,
    emit: (message) => {
      if (message.method === "claude/activity")
        options.onActivity?.(message.params);
      for (const socket of clients.clients)
        if (
          !message.params?.session ||
          socket.selected === message.params.session.id
        )
          send(socket, message);
    },
  });
  const handler = async (method, p, socket) => {
    switch (method) {
      case "list":
        return sessions.list(p);
      case "create":
        return sessions.create(p);
      case "open":
        socket.selected = p.id;
        return sessions.open(p.id, p.offset);
      case "status":
        socket.selected = p.id;
        return sessions.status(p.id);
      case "configure":
        return sessions.configure(p);
      case "send":
        return sessions.send(p);
      case "interrupt":
        return sessions.interrupt(p.id);
      case "answer":
        return sessions.answer(p);
      case "release":
        return sessions.release(p.id);
      default:
        throw Error("未知的 Claude 操作");
    }
  };
  server.on("upgrade", (request, socket, head) => {
    if (new URL(request.url, "http://localhost").pathname !== "/claude/rpc")
      return;
    try {
      if (
        request.headers.origin &&
        new URL(request.headers.origin).host !== request.headers.host
      ) {
        socket.destroy();
        return;
      }
    } catch {
      socket.destroy();
      return;
    }
    clients.handleUpgrade(request, socket, head, (client) =>
      clients.emit("connection", client),
    );
  });
  clients.on("connection", (socket) => {
    socket.alive = true;
    socket.on("pong", () => {
      socket.alive = true;
    });
    socket.on("error", () => {});
    send(socket, { method: "claude/ready" });
    socket.on("message", async (bytes) => {
      let m;
      try {
        m = JSON.parse(bytes.toString());
      } catch {
        return;
      }
      if (!m || !Number.isSafeInteger(m.id) || typeof m.method !== "string")
        return;
      try {
        send(socket, {
          id: m.id,
          result: await handler(m.method, m.params || {}, socket),
        });
      } catch (error) {
        send(socket, { id: m.id, error: { message: error.message } });
      }
    });
  });
  const heartbeat = setInterval(() => {
    for (const socket of clients.clients) {
      if (!socket.alive) socket.terminate();
      else {
        socket.alive = false;
        socket.ping();
      }
    }
  }, 30000);
  heartbeat.unref();
  server.on("close", () => {
    clearInterval(heartbeat);
    clients.close();
    sessions.close();
  });
  return sessions;
}
