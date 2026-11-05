import { fullAccessParams } from "../domain/execution-policy.js";
import { MAX_RPC_MESSAGE_BYTES } from "../../../shared/rpc-limits.mjs";
import { PROVIDER_PREPARATION_TIMEOUT_MS } from "../../../shared/provider-lifecycle.mjs";

// 每个实例独立持有连接和待完成请求，替换连接后丢弃旧连接的响应。
export function createRpcClient({
  isConnected,
  authenticated,
  requestContext,
  onNotification,
  onRequest,
  onResponse,
  onClose,
}) {
  let connection;
  let sequence = 1;
  const pending = new Map();

  function rejectPending(error) {
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    pending.clear();
  }

  function rpc(
    method,
    params = {},
    timeout = ["thread/resume", "turn/start"].includes(method)
      ? PROVIDER_PREPARATION_TIMEOUT_MS + 120000
      : 120000,
  ) {
    return new Promise((resolve, reject) => {
      if (!isConnected() || connection?.readyState !== WebSocket.OPEN)
        return reject(new Error("与电脑的连接尚未就绪，正在自动重连。"));
      const id = sequence++;
      const message = JSON.stringify({
        id,
        method,
        params: fullAccessParams(method, params),
      });
      if (new TextEncoder().encode(message).byteLength > MAX_RPC_MESSAGE_BYTES)
        return reject(
          new Error("单次消息过大（最多 64 MiB），请减少附件后重试。"),
        );
      const timer = timeout
        ? setTimeout(() => {
            pending.delete(id);
            reject(new Error("请求等待超时，请刷新会话查看任务状态。"));
          }, timeout)
        : null;
      pending.set(id, {
        ...requestContext(),
        method,
        resolve,
        reject,
        timer,
        threadId: params.threadId,
      });
      try {
        connection.send(message);
      } catch (error) {
        clearTimeout(timer);
        pending.delete(id);
        reject(error);
      }
    });
  }

  function connect() {
    if (!authenticated()) return;
    if (connection) disconnect(new Error("连接已更新，请在新连接就绪后重试。"));
    const socket = new WebSocket(`wss://${location.host}/rpc`);
    connection = socket;
    socket.onmessage = (event) => {
      if (connection !== socket || !authenticated()) return;
      const message = JSON.parse(event.data);
      if (message.id !== undefined && !message.method) {
        const request = pending.get(message.id);
        if (!request) return;
        clearTimeout(request.timer);
        pending.delete(message.id);
        const error = message.error ? new Error(message.error.message) : null;
        if (error) error.code = message.error.code;
        onResponse(request, message, error);
        if (error) request.reject(error);
        else request.resolve(message.result);
      } else if (message.id !== undefined) onRequest(message);
      else onNotification(message);
    };
    socket.onclose = (event) => {
      if (connection !== socket) return;
      rejectPending(
        new Error("连接中断，正在重连；已提交的任务会在电脑上继续。"),
      );
      onClose(event, socket);
    };
    socket.onerror = () => {};
  }

  function disconnect(error) {
    const socket = connection;
    connection = null;
    rejectPending(error);
    if (socket?.readyState < 2) socket.close();
  }

  return {
    rpc,
    connect,
    disconnect,
    pending,
    get connection() {
      return connection;
    },
  };
}
