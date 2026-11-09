import WebSocket from "ws";
import { threadMethods } from "./methods.mjs";
export function createBridgeEvents({
  questions,
  activeTurns,
  activeThreads,
  terminals,
  subscriptions,
  unwrittenThreads,
  compactions,
  threadNaming,
  send,
  broadcast,
  state,
  releaseUnusedThreads,
}) {
  function onEvent(message) {
    if (message.id !== undefined) questions.set(String(message.id), message);
    const p = message.params || {};
    if (
      ["thread/name/updated", "thread/deleted", "thread/archived"].includes(
        message.method,
      )
    )
      threadNaming.cancel(p.threadId);
    if (message.method === "turn/started") {
      activeTurns.set(p.threadId, p.turn.id);
      activeThreads.add(p.threadId);
      unwrittenThreads.delete(p.threadId);
    }
    if (
      message.method === "turn/completed" &&
      (!activeTurns.has(p.threadId) ||
        activeTurns.get(p.threadId) === p.turn.id)
    ) {
      activeTurns.delete(p.threadId);
      activeThreads.delete(p.threadId);
    }
    if (message.method === "thread/status/changed") {
      if (p.status.type === "active") activeThreads.add(p.threadId);
      else activeThreads.delete(p.threadId);
    }
    if (
      ["thread/closed", "thread/deleted", "thread/archived"].includes(
        message.method,
      )
    ) {
      subscriptions.delete(p.threadId);
      unwrittenThreads.delete(p.threadId);
      activeThreads.delete(p.threadId);
      activeTurns.delete(p.threadId);
      if (message.method !== "thread/closed")
        compactions.entries.delete(p.threadId);
    }
    if (
      message.method === "command/exec/outputDelta" &&
      terminals.has(p.processId)
    ) {
      const terminal = terminals.get(p.processId);
      terminal.buffer = (
        terminal.buffer + Buffer.from(p.deltaBase64, "base64").toString("utf8")
      ).slice(-200000);
    }
    if (message.method === "serverRequest/resolved") {
      questions.delete(String(p.requestId));
      broadcast(state());
    }
    broadcast(message);
    compactions.event(message.method, p);
    releaseUnusedThreads();
    if (message.method === "turn/completed")
      threadNaming.schedule({ id: p.threadId });
    return;
  }
  function onResponse(request, message) {
    if (message.error && request.method === "thread/compact/start")
      compactions.reject(request.threadId, message.id, message.error.message);
    if (
      !message.error &&
      threadMethods.has(request.method) &&
      message.result?.thread?.id
    ) {
      const thread = message.result.thread;
      if (!subscriptions.has(thread.id))
        subscriptions.set(thread.id, new Set());
      if (!request.timedOut && request.client.readyState === WebSocket.OPEN)
        subscriptions.get(thread.id).add(request.client);
      if (request.method === "thread/start") unwrittenThreads.add(thread.id);
      if (thread.status?.type === "active") activeThreads.add(thread.id);
    }
    if (request.threadId && message.result?.turn?.status === "inProgress") {
      activeTurns.set(request.threadId, message.result.turn.id);
      activeThreads.add(request.threadId);
    }
    if (
      !message.error &&
      ["turn/start", "thread/compact/start", "review/start"].includes(
        request.method,
      )
    )
      unwrittenThreads.delete(request.threadId);
    if (request.processId && terminals.has(request.processId)) {
      terminals.get(request.processId).running = false;
      broadcast({
        method: "lan/terminalExit",
        params: {
          processId: request.processId,
          exitCode: message.result?.exitCode,
        },
      });
    }
    if (!request.timedOut) send(request.client, { ...message, id: request.id });
    releaseUnusedThreads();
    if (!message.error && !request.timedOut) {
      if (request.method === "turn/start")
        threadNaming.schedule(
          { id: request.threadId },
          { text: request.nameText, model: request.model },
        );
      else if (["thread/read", "thread/resume"].includes(request.method))
        threadNaming.schedule(message.result?.thread);
    }
  }
  return { onEvent, onResponse };
}
