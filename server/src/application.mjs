import https from "node:https";
import { attachClaude } from "./claude-web.mjs";
import { createNtfy } from "./ntfy.mjs";
import { codexNotification } from "./notification-events.mjs";
import { WebSocketServer } from "ws";
import { createHttpHandler } from "./http/router.mjs";
import { createBridge } from "./bridge/create-bridge.mjs";
import { sendRpcText } from "./rpc-transport.mjs";
export function createWebApplication({ config, tls, authentication, version }) {
  const ntfy = createNtfy();
  const clients = new WebSocketServer({ noServer: true });
  const monitors = new WebSocketServer({ noServer: true });
  function send(client, message) {
    if (client.authSessionId && !authentication.valid(client.authSessionId))
      return;
    sendRpcText(client, JSON.stringify(message));
  }
  function broadcast(message) {
    const event = codexNotification(message);
    if (event) void ntfy.publish(event);
    for (const client of clients.clients) send(client, message);
    if (
      [
        "lan/state",
        "lan/compaction",
        "turn/started",
        "turn/completed",
      ].includes(message.method)
    )
      for (const monitor of monitors.clients)
        send(monitor, bridge.maintenanceState());
  }
  const bridge = createBridge({ config, version, send, broadcast });
  const { state, maintenanceState, releaseUnusedThreads, subscriptions } =
    bridge;
  const server = https.createServer(
    tls,
    createHttpHandler({
      config,
      tls,
      authentication,
      version,
      isReady: () => bridge.ready,
      extraHealth: () => ({ claude: { enabled: true, busy: claude.busy } }),
    }),
  );
  const claude = attachClaude(server, config, {
    authentication,
    onActivity: (event) => {
      void ntfy.publish({ ...event, provider: "claude" });
    },
  });
  server.on("upgrade", (request, socket, head) => {
    const path = new URL(request.url, "https://localhost").pathname;
    if (path === "/claude/rpc") return;
    if (path === "/maintenance" && authentication.maintenance(request)) {
      monitors.handleUpgrade(request, socket, head, (monitor) => {
        monitor.on("error", () => {});
        monitor.on("message", () => monitor.close(1008, "只读维护连接"));
        send(monitor, maintenanceState());
      });
      return;
    }
    if (path !== "/rpc") {
      socket.destroy();
      return;
    }
    const id = authentication.sessionId(request);
    if (!authentication.sameOrigin(request) || !authentication.valid(id)) {
      socket.end("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      return;
    }
    clients.handleUpgrade(request, socket, head, (client) => {
      authentication.attach(client, id);
      clients.emit("connection", client);
    });
  });

  clients.on("connection", (client) => {
    client.alive = true;
    client.on("pong", () => {
      client.alive = true;
    });
    client.on("error", (error) =>
      console.error("Browser connection:", error.message),
    );
    client.on("close", () => {
      for (const owners of subscriptions.values()) owners.delete(client);
      releaseUnusedThreads();
    });
    send(client, state());

    client.on("message", (bytes) => {
      if (!authentication.valid(client.authSessionId)) return;
      let message;
      try {
        message = JSON.parse(bytes.toString());
      } catch {
        return;
      }
      bridge.receive(client, message).catch((error) =>
        send(client, {
          id: message.id,
          error: { code: -32000, message: error.message },
        }),
      );
    });
  });
  const heartbeat = setInterval(() => {
    for (const client of clients.clients) {
      if (!client.alive) client.terminate();
      else {
        client.alive = false;
        client.ping();
      }
    }
    releaseUnusedThreads();
  }, 30000);
  heartbeat.unref();

  server.requestTimeout = 20000;
  server.headersTimeout = 10000;
  return {
    server,
    async start() {
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(config.port, config.host, () => {
          server.off("error", reject);
          resolve();
        });
      });
      bridge.connect();
    },
    async close() {
      clearInterval(heartbeat);
      bridge.close();
      claude.closeClients();
      claude.close();
      await ntfy.close();
      for (const client of [...clients.clients, ...monitors.clients])
        client.terminate();
      clients.close();
      monitors.close();
      if (server.listening)
        await new Promise((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
    },
  };
}
