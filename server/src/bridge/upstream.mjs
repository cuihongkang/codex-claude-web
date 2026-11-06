import WebSocket from "ws";
import { sendRpcText } from "../rpc-transport.mjs";

export function createUpstream({
  config,
  version,
  send,
  onReady,
  onEvent,
  onResponse,
  onSettled,
  onDisconnect,
}) {
  const pending = new Map();
  let socket;
  let ready = false;
  let sequence = 1;
  let reconnectTimer;
  let closed = false;
  const nextId = () => sequence++;

  function rejectPending(message) {
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      if (request.reject) request.reject(new Error(message));
      else
        send(request.client, {
          id: request.id,
          error: { code: -32000, message },
        });
    }
    pending.clear();
  }

  function call(
    method,
    params,
    { trackThread = true, timeoutMessage = "恢复对话超时" } = {},
  ) {
    return new Promise((resolve, reject) => {
      const id = nextId();
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(timeoutMessage));
      }, 120000);
      pending.set(id, {
        resolve,
        reject,
        timer,
        method,
        ...(trackThread && { threadId: params.threadId }),
      });
      sendRpcText(socket, JSON.stringify({ id, method, params }));
    });
  }

  function connect() {
    if (closed) return;
    const connection = new WebSocket(config.upstreamUrl);
    socket = connection;
    connection.on("open", () =>
      sendRpcText(
        connection,
        JSON.stringify({
          id: 0,
          method: "initialize",
          params: {
            clientInfo: {
              name: "claudex_web",
              title: "Claudex Web",
              version: version.displayVersion,
            },
            capabilities: { experimentalApi: true },
          },
        }),
      ),
    );
    connection.on("message", (bytes) => {
      if (socket !== connection || closed) return;
      const message = JSON.parse(bytes.toString());
      if (message.id === 0 && !message.method) {
        if (message.error) {
          console.error("Initialization failed:", message.error.message);
          connection.close();
          return;
        }
        sendRpcText(connection, JSON.stringify({ method: "initialized" }));
        ready = true;
        onReady();
        return;
      }
      if (message.method) {
        onEvent(message);
        return;
      }
      const request = pending.get(message.id);
      if (!request) return;
      clearTimeout(request.timer);
      pending.delete(message.id);
      if (request.resolve) {
        if (message.error) request.reject(new Error(message.error.message));
        else request.resolve(message.result);
        onSettled();
      } else onResponse(request, message);
    });
    connection.on("error", (error) =>
      console.error("App-server connection:", error.message),
    );
    connection.on("close", (code, reason) => {
      if (socket !== connection || closed) return;
      console.error(
        "App-server disconnected:",
        JSON.stringify({
          code,
          reason: reason.toString(),
          pendingMethods: [
            ...new Set([...pending.values()].map((request) => request.method)),
          ],
        }),
      );
      ready = false;
      rejectPending("Codex 后端连接中断，请重试。");
      onDisconnect();
      reconnectTimer = setTimeout(connect, 2000);
    });
  }

  function close() {
    closed = true;
    ready = false;
    clearTimeout(reconnectTimer);
    rejectPending("网页桥接已关闭");
    socket?.terminate();
  }

  return {
    call,
    connect,
    close,
    nextId,
    pending,
    send: (message) => sendRpcText(socket, JSON.stringify(message)),
    sendText: (text) => sendRpcText(socket, text),
    get ready() {
      return ready;
    },
  };
}
