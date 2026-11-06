import { join } from "node:path";
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

export function createBridge({ config, version, send, broadcast }) {
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
  const files = createFileOperations({
    call: transport.call,
    activeTurns,
    activeThreads,
    broadcast,
  });
  const methods = createLocalMethods({
    config,
    projectModels: createProjectModels(
      config.configDir,
      join(config.codexHome, "codex-web"),
    ),
    call: transport.call,
    checkCompaction,
    files,
    broadcast,
  });
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
        version,
        defaultCwd: config.defaultCwd,
        projectlessRoot: config.projectlessRoot,
        projectModels: true,
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
      transport.close();
      subscriptions.reset();
    },
    get ready() {
      return transport.ready;
    },
  };
}
