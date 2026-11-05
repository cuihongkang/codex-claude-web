import { createProjectModels } from "../project-models.mjs";
import { createCompactions } from "../compaction.mjs";
import { createThreadNaming, generateThreadName } from "../thread-names.mjs";
import { createUpstream } from "./upstream.mjs";
import { createSubscriptions } from "./subscriptions.mjs";
import { createCompactionRecovery } from "./compaction-recovery.mjs";
import { createBridgeEvents } from "./events.mjs";
import { createRequestHandler } from "./requests.mjs";
import { createFileOperations } from "./file-operations.mjs";
import { createLocalMethods } from "./local-methods.mjs";

import { createProviderRouting } from "../providers/routing.mjs";

export function createBridge({ config, version, send, broadcast, providers }) {
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
      routing.reset();
      subscriptions.reset();
      for (const terminal of terminals.values()) terminal.running = false;
      broadcast(state());
    },
  });
  providers.connect(transport.call);
  const threadNaming = createThreadNaming({
    call: transport.call,
    generate: async (params) => {
      const settings = await routing.resumeParameters(params.threadId);
      return generateThreadName({
        ...params,
        ...settings,
        providerConfig: settings.config,
        url: config.upstreamUrl,
        version: version.displayVersion,
      });
    },
    onError: (error) => console.error("Thread title:", error.message),
  });
  const subscriptions = createSubscriptions({
    transport,
    compactions,
    activeTurns,
    activeThreads,
    resumeParameters: (id) => routing.resumeParameters(id),
    onReleasing: (id) => routing.trackClosing(id),
    isReserved: (id) => routing.isReserved(id),
  });
  const routing = createProviderRouting({
    onSelection: (params) =>
      broadcast({ method: "lan/providers/thread", params }),
    registry: providers,
    transport,
    subscriptions,
    activeTurns,
    activeThreads,
    compactions,
  });
  const checkCompaction = createCompactionRecovery({
    transport,
    compactions,
    ...subscriptions,
  });
  const files = createFileOperations({
    call: transport.call,
    activeTurns,
    activeThreads,
    broadcast,
  });
  const methods = createLocalMethods({
    config,
    projectModels: createProjectModels(config.codexHome),
    call: transport.call,
    checkCompaction,
    files,
    broadcast,
  });
  for (const [method, action] of [
    ["lan/providers/read", async () => ({ providers: await providers.list() })],
    [
      "lan/providers/set",
      async (params) => ({ providers: await providers.set(params) }),
    ],
    [
      "lan/providers/remove",
      async ({ id }) => ({ providers: await providers.remove(id) }),
    ],
    ["lan/providers/models", ({ id }) => providers.discover(id)],
  ])
    methods.online.set(method, async (params) => {
      if (
        ["lan/providers/remove", "lan/providers/set"].includes(method) &&
        params.id &&
        (await routing.providerBusy(params.id))
      )
        throw new Error("请等待此供应商的任务结束后修改配置。");
      const result = await action(params);
      if (method === "lan/providers/set" || method === "lan/providers/remove")
        broadcast({ method: "lan/providers/updated", params: result });
      return result;
    });
  const events = createBridgeEvents({
    routing,
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
    routing,
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
        version,
        defaultCwd: config.defaultCwd,
        projectlessRoot: config.projectlessRoot,
        projectModels: true,
        providers: true,
        questions: [...questions.values()],
        activeTurns: Object.fromEntries(activeTurns),
        compactions: Object.fromEntries(compactions.entries),
        terminals: Object.fromEntries(terminals),
        undoneFiles: [...files.undoneFiles.values()],
      },
    };
  }
  function maintenanceState() {
    return {
      method: "lan/state",
      params: {
        ready: transport.ready,
        activeTurns: Object.fromEntries(activeTurns),
        compactions: Object.fromEntries(
          [...compactions.entries].map(([id, entry]) => [
            id,
            { status: entry.status },
          ]),
        ),
      },
    };
  }
  return {
    state,
    maintenanceState,
    receive,
    connect: transport.connect,
    releaseUnusedThreads: subscriptions.releaseUnusedThreads,
    subscriptions: subscriptions.subscriptions,
    close() {
      threadNaming.clear();
      routing.reset();
      transport.close();
      subscriptions.reset();
    },
    get ready() {
      return transport.ready;
    },
  };
}
