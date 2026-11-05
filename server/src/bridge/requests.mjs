import { MAX_RPC_MESSAGE_BYTES } from "../rpc-transport.mjs";
import { threadMethods, loadedThreadMethods } from "./methods.mjs";
export function createRequestHandler({
  transport,
  compactions,
  threadNaming,
  activeTurns,
  activeThreads,
  terminals,
  questions,
  undoing,
  subscriptions,
  releasing,
  resumeForWrite,
  releaseUnusedThreads,
  offline,
  online,
  send,
  broadcast,
}) {
  async function dispatchLocal(handlers, client, message) {
    const handle = handlers.get(message.method);
    if (!handle) return false;
    try {
      send(client, {
        id: message.id,
        result: await handle(message.params || {}),
      });
    } catch (error) {
      send(client, {
        id: message.id,
        error: { code: -32000, message: error.message },
      });
    }
    return true;
  }
  return async function handleRequest(client, message) {
    if (await dispatchLocal(offline, client, message)) return;
    const threadId = message.params?.threadId;
    if (threadId && releasing.has(threadId)) await releasing.get(threadId);
    if (!transport.ready) {
      send(client, {
        id: message.id,
        error: { code: -32000, message: "正在连接 Codex，请稍后重试。" },
      });
      return;
    }
    if (await dispatchLocal(online, client, message)) return;
    if (message.method) {
      if (
        [
          "thread/revert",
          "thread/rollback",
          "turn/start",
          "turn/steer",
          "thread/compact/start",
          "review/start",
        ].includes(message.method) &&
        compactions.busy(threadId)
      ) {
        send(client, {
          id: message.id,
          error: {
            code: -32000,
            message: "正在整理上下文，完成后可继续发送。",
          },
        });
        return;
      }
      if (
        message.method === "thread/compact/start" &&
        (activeTurns.has(threadId) ||
          activeThreads.has(threadId) ||
          [...transport.pending.values()].some(
            (request) =>
              request.threadId === threadId &&
              ["turn/start", "review/start"].includes(request.method),
          ))
      ) {
        send(client, {
          id: message.id,
          error: { code: -32000, message: "请等待当前任务结束后整理上下文。" },
        });
        return;
      }

      if (
        ["thread/name/set", "thread/delete", "thread/archive"].includes(
          message.method,
        )
      )
        threadNaming.cancel(threadId);
      if (message.method === "thread/unsubscribe") {
        subscriptions.get(threadId)?.delete(client);
        releaseUnusedThreads();
        const result = await releasing.get(threadId);
        send(client, {
          id: message.id,
          result: result || { status: "unsubscribed" },
        });
        return;
      }
      if (undoing.has(threadId) && loadedThreadMethods.has(message.method)) {
        send(client, {
          id: message.id,
          error: {
            code: -32000,
            message: "正在撤销文件修改，完成后可继续发送。",
          },
        });
        return;
      }
      if (threadMethods.has(message.method))
        message.params = {
          ...message.params,
          config: { ...message.params?.config, thread_unload_delay_secs: 0 },
        };
      const id = transport.nextId();
      const forwarded = JSON.stringify({ ...message, id });
      if (Buffer.byteLength(forwarded) > MAX_RPC_MESSAGE_BYTES) {
        send(client, {
          id: message.id,
          error: {
            code: -32600,
            message: "单次消息过大（最多 64 MiB），请减少附件后重试。",
          },
        });
        return;
      }
      const processId =
        message.method === "command/exec" && message.params?.processId;
      if (processId) {
        terminals.set(processId, { buffer: "", running: true });
        broadcast({ method: "lan/terminalStarted", params: { processId } });
      }
      const timer = processId
        ? null
        : setTimeout(() => {
            if (threadMethods.has(message.method))
              transport.pending.get(id).timedOut = true;
            else {
              transport.pending.delete(id);
              releaseUnusedThreads();
            }
            send(client, {
              id: message.id,
              error: {
                code: -32000,
                message: "请求等待超时；任务可能仍在继续，请刷新会话查看。",
              },
            });
          }, 120000);
      transport.pending.set(id, {
        client,
        id: message.id,
        timer,
        processId,
        method: message.method,
        threadId,
        ...(message.method === "turn/start" && {
          nameText: (message.params?.input || [])
            .filter((item) => item.type === "text")
            .map((item) => item.text)
            .join("\n"),
          model: message.params?.model,
        }),
      });
      if (message.method === "thread/compact/start")
        compactions.start(threadId, id);
      if (threadId && loadedThreadMethods.has(message.method)) {
        try {
          await resumeForWrite(threadId);
        } catch (error) {
          if (message.method === "thread/compact/start")
            compactions.reject(threadId, id, error.message);
          clearTimeout(timer);
          if (transport.pending.delete(id))
            send(client, {
              id: message.id,
              error: { code: -32000, message: error.message },
            });
          releaseUnusedThreads();
          return;
        }
        if (!transport.pending.has(id)) {
          releaseUnusedThreads();
          return;
        }
      }
      transport.sendText(forwarded);
    } else if (message.id !== undefined && questions.has(String(message.id))) {
      transport.send(message);
      questions.delete(String(message.id));
      broadcast({ method: "lan/questionResolved", params: { id: message.id } });
    }
  };
}
