import { referenceToolParams } from "./reference-tools.mjs";
import { join } from "node:path";
import { codexCapabilities } from "../../../../shared/backend-capabilities.mjs";
import { readAgentMessages } from "../../agent-messages.mjs";
import { createCompactions } from "../../compaction.mjs";
import { createThreadNaming, generateThreadName } from "../../thread-names.mjs";
import { createUpstream } from "./upstream.mjs";
import { createSubscriptions } from "./subscriptions.mjs";
import { createCompactionRecovery } from "./compaction-recovery.mjs";
import { createBridgeEvents } from "./events.mjs";
import { createRequestHandler } from "./requests.mjs";
import { createProductMethods } from "../../bridge/product-methods.mjs";

export function createCodexAdapter({
  backend,
  config,
  version,
  send,
  broadcast,
}) {
  config = { ...config, upstreamUrl: backend.url, codexHome: backend.dataDir };
  const questions = new Map();
  const activeTurns = new Map();
  const activeThreads = new Set();
  const terminals = new Map();
  const compactions = createCompactions(broadcast);
  const transport = createUpstream({
    config,
    version,
    send,
    onReady() {
      broadcast(state());
      for (const [threadId, entry] of compactions.entries)
        if (entry.status === "reconnecting")
          checkCompaction(threadId).catch(() => {});
    },
    onEvent: (message) => events.onEvent(message),
    onResponse: (request, message) => events.onResponse(request, message),
    onSettled: () => subscriptions.releaseUnusedThreads(),
    onDisconnect() {
      compactions.disconnected();
      threadNaming.clear();
      questions.clear();
      activeTurns.clear();
      activeThreads.clear();
      subscriptions.reset();
      for (const terminal of terminals.values()) terminal.running = false;
      broadcast(state());
    },
  });
  const nativeCall = transport.call;
  transport.call = (method, params, options) =>
    nativeCall(method, referenceToolParams(method, params, config), options);
  const threadNaming = createThreadNaming({
    call: transport.call,
    generate: (params) =>
      generateThreadName({
        ...params,
        url: config.upstreamUrl,
        version: version.displayVersion,
      }),
    onError: (error) => console.error("Thread title:", error.message),
  });
  const subscriptions = createSubscriptions({
    transport,
    compactions,
    activeTurns,
    activeThreads,
  });
  const checkCompaction = createCompactionRecovery({
    transport,
    compactions,
    ...subscriptions,
  });
  const methods = createProductMethods({
    config,
    projectModelsDirectory: config.configDir,
    legacyProjectModelsDirectory: join(config.codexHome, "codex-web"),
    call: transport.call,
    activeTurns,
    activeThreads,
    checkCompaction,
    readAgentMessages: (threadId) =>
      readAgentMessages(transport.call, threadId),
    broadcast,
  });
  const { files } = methods;
  const events = createBridgeEvents({
    questions,
    activeTurns,
    activeThreads,
    terminals,
    ...subscriptions,
    compactions,
    threadNaming,
    send,
    broadcast,
    state,
  });
  const receive = createRequestHandler({
    transport,
    compactions,
    threadNaming,
    activeTurns,
    activeThreads,
    terminals,
    questions,
    undoing: files.undoing,
    ...subscriptions,
    ...methods,
    send,
    broadcast,
  });

  function state() {
    return {
      method: "lan/state",
      params: {
        ready: transport.ready,
        questions: [...questions.values()],
        activeTurns: Object.fromEntries(activeTurns),
        compactions: Object.fromEntries(compactions.entries),
        terminals: Object.fromEntries(terminals),
        undoneFiles: [...files.undoneFiles.values()],
      },
    };
  }
  return {
    capabilities: codexCapabilities,
    workspaceOwner: "backend",
    state,
    receive(client, message) {
      if (!message.method) return receive(client, message);
      const { providerId, ...params } = message.params || {};
      if (providerId) throw new Error("Codex 使用现有账户与模型配置");
      return receive(client, {
        ...message,
        params: referenceToolParams(message.method, params, config),
      });
    },
    connect: transport.connect,
    releaseUnusedThreads: subscriptions.releaseUnusedThreads,
    releaseClient: subscriptions.releaseClient,
    close() {
      threadNaming.clear();
      transport.close();
      subscriptions.reset();
    },
    get ready() {
      return transport.ready;
    },
  };
}
