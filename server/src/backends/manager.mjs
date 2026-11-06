import { join } from "node:path";
import { readProjectlessDirectories } from "../thread-projects.mjs";
import { createWorkspace } from "../workspace/service.mjs";
import { isCompacting } from "../../../shared/compaction-state.mjs";
import {
  resourceTarget,
  resourceId,
} from "../../../shared/backend-identity.mjs";
import {
  createBackendConfiguration,
  validateBackend,
} from "./configuration.mjs";
import { createProviders } from "./providers.mjs";
import { createCodexAdapter } from "./codex-adapter.mjs";
import { createClaudeWorkerAdapter } from "./claude/worker-client.mjs";
import { mapResult, mapState, nativeParams } from "./identity-mapping.mjs";

export function createBackendManager({
  config,
  version,
  send,
  broadcast,
  factories = {},
}) {
  const workspace = createWorkspace({ broadcast });
  const configuration = createBackendConfiguration(config);
  const providers = createProviders(configuration);
  const instances = new Map();
  let initialized = false,
    closed = false,
    sequence = 0;
  let changing = Promise.resolve();
  const publicBackends = () =>
    [...instances.values()].map(({ backend, adapter, error }) => ({
      ...backend,
      ready: Boolean(adapter?.ready),
      capabilities: adapter?.capabilities || {},
      error: error || adapter?.state().params.error || null,
    }));
  function state() {
    const states = [...instances.values()]
      .filter((i) => i.adapter)
      .map((i) => mapState(i.adapter.state().params, i.backend.id));
    const merge = (name) => Object.assign({}, ...states.map((s) => s[name]));
    return {
      method: "lan/state",
      params: {
        ready: [...instances.values()].some((i) => i.adapter?.ready),
        bridgeReady: initialized,
        protocolVersion: 2,
        backends: publicBackends(),
        defaultBackendId:
          [...instances.values()].find((i) => i.backend.enabled)?.backend.id ||
          "codex",
        version,
        defaultCwd: config.defaultCwd,
        projectlessRoot: config.projectlessRoot,
        projectlessRoots: [
          config.projectlessRoot,
          ...(config.legacyConfigDir
            ? [join(config.legacyConfigDir, "workspaces")]
            : []),
          join(
            instances.get("codex")?.backend.dataDir || config.codexHome,
            "codex-web",
            "workspaces",
          ),
        ],
        projectModels: true,
        questions: states.flatMap((s) => s.questions),
        activeTurns: merge("activeTurns"),
        executionStatuses: merge("executionStatuses"),
        compactions: merge("compactions"),
        terminals: { ...merge("terminals"), ...workspace.snapshot() },
        undoneFiles: states.flatMap((s) => s.undoneFiles),
      },
    };
  }
  function emitState() {
    if (!closed) broadcast(state());
  }
  async function install(backend) {
    const entry = { backend, adapter: null, error: null, proxies: new Map() };
    instances.set(backend.id, entry);
    if (!backend.enabled) return;
    try {
      const factory =
        factories[backend.type] ||
        (backend.type === "codex"
          ? createCodexAdapter
          : createClaudeWorkerAdapter);
      entry.adapter = factory({
        backend,
        config,
        version,
        providers,
        workspace,
        send(client, message) {
          client.deliver(message);
        },
        broadcast(message) {
          if (instances.get(backend.id) !== entry || closed) return;
          if (message.method === "lan/state") return emitState();
          broadcast({
            ...message,
            ...(backend.id !== "codex" && { backendId: backend.id }),
            ...(message.id !== undefined && {
              id: resourceId(backend.id, message.id),
            }),
            params: mapResult(message.params, backend.id, message.method),
          });
        },
      });
      await entry.adapter.connect();
    } catch (error) {
      entry.error = error.message;
    }
  }
  async function connect() {
    const data = await configuration.read();
    await Promise.all(data.backends.map(install));
    initialized = true;
    emitState();
  }
  function instance(id) {
    const entry = instances.get(id);
    if (entry?.changing) throw new Error("后端配置正在更新，请稍后重试。");
    if (!entry?.adapter)
      throw new Error(entry?.error || "后端未启用，请在设置中检查配置。");
    return entry;
  }
  function proxy(entry, client) {
    if (!entry.proxies.has(client)) {
      const methods = new Map();
      entry.proxies.set(client, {
        get readyState() {
          return client.readyState;
        },
        methods,
        deliver(message) {
          const method = methods.get(message.id);
          methods.delete(message.id);
          send(client, {
            ...message,
            ...(message.result && {
              result: mapResult(message.result, entry.backend.id, method),
            }),
          });
        },
      });
    }
    return entry.proxies.get(client);
  }
  function call(entry, method, params) {
    return new Promise((resolve, reject) => {
      const id = `manager-${++sequence}`;
      const timer = setTimeout(() => reject(new Error("后端读取超时")), 120000);
      const client = {
        readyState: 3,
        deliver(message) {
          clearTimeout(timer);
          if (message.error) reject(new Error(message.error.message));
          else resolve(mapResult(message.result, entry.backend.id, method));
        },
      };
      Promise.resolve(
        entry.adapter.receive(client, { id, method, params }),
      ).catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
  }
  async function listThreads(params) {
    const ids = [...instances.values()]
      .filter((i) => i.backend.enabled)
      .map((i) => i.backend.id);
    const position = params.cursor
      ? JSON.parse(decodeURIComponent(params.cursor))
      : { index: 0 };
    const errors = [];
    while (position.index < ids.length) {
      const backendId = ids[position.index];
      try {
        const entry = instance(backendId);
        const page = await call(entry, "thread/list", {
          ...params,
          cursor: position.cursor,
        });
        const next = page.nextCursor
          ? { ...position, cursor: page.nextCursor }
          : { index: position.index + 1 };
        return {
          ...page,
          backendErrors: errors,
          nextCursor:
            next.index < ids.length
              ? encodeURIComponent(JSON.stringify(next))
              : null,
        };
      } catch (error) {
        errors.push({ backendId, message: error.message });
        position.index++;
        delete position.cursor;
      }
    }
    return { data: [], nextCursor: null, backendErrors: errors };
  }
  async function saveBackend(params) {
    validateBackend(params, config);
    const old = instances.get(params.id);
    const snapshot = old?.adapter?.state().params;
    if (
      Object.keys(snapshot?.activeTurns || {}).length ||
      snapshot?.internalCommands?.length ||
      Object.values(snapshot?.compactions || {}).some(isCompacting)
    )
      throw new Error("请等待此后端的任务结束后修改配置。");
    if (old) old.changing = true;
    try {
      await old?.adapter?.shutdown?.();
      const backend = await configuration.save(params);
      old?.adapter?.close();
      await install(backend);
    } catch (error) {
      if (old) {
        old.changing = false;
        if (!old.adapter?.ready) {
          old.adapter?.close();
          await install(old.backend);
        }
      }
      throw error;
    }
    emitState();
    return { backends: publicBackends() };
  }
  async function receive(client, message) {
    const method = message.method,
      params = message.params || {};
    const reply = (result) => send(client, { id: message.id, result });
    const fallback =
      params.threadId != null
        ? "codex"
        : params.backendId || state().params.defaultBackendId;
    const target = resourceTarget(
      params.threadId ?? params.processId ?? (!method ? message.id : null),
      fallback,
    );
    if (workspace.handles(method) && target.backendId !== "codex")
      return reply(await workspace.request(method, params));
    if (method === "lan/projectless/read")
      return reply({
        directories: await readProjectlessDirectories(
          instances.get("codex")?.backend.dataDir || config.codexHome,
        ),
      });
    if (method === "lan/backends/list")
      return reply({ backends: publicBackends() });
    if (
      [
        "lan/backends/save",
        "lan/backends/disable",
        "lan/backends/check",
      ].includes(method)
    ) {
      const input =
        method === "lan/backends/save"
          ? params
          : {
              ...instances.get(params.id)?.backend,
              ...(method.endsWith("disable") && { enabled: false }),
            };
      const operation = changing.then(() => saveBackend(input));
      changing = operation.catch(() => {});
      return reply(await operation);
    }
    if (method === "lan/providers/list")
      return reply({
        providers: await providers.list(params.backendId, {
          includeDisabled: params.includeDisabled === true,
        }),
      });
    if (method === "lan/providers/save")
      return reply({ providers: await providers.save(params) });
    if (method === "lan/providers/remove")
      return reply({ providers: await providers.remove(params) });
    if (method === "thread/list" && !params.backendId)
      return reply(await listThreads(params));
    const entry = instance(target.backendId);
    const recipient = proxy(entry, client);
    recipient.methods.set(message.id, method);
    await entry.adapter.receive(recipient, {
      ...message,
      ...(!method && { id: target.nativeId }),
      ...(method && { params: nativeParams(params, entry.backend.id) }),
    });
  }
  function releaseClient(client) {
    for (const entry of instances.values()) {
      const recipient = entry.proxies.get(client);
      for (const owners of entry.adapter?.subscriptions?.values() || [])
        owners.delete(recipient);
      entry.proxies.delete(client);
      entry.adapter?.releaseUnusedThreads();
    }
  }
  return {
    state,
    receive,
    connect,
    releaseClient,
    releaseUnusedThreads() {
      for (const i of instances.values()) i.adapter?.releaseUnusedThreads();
    },
    maintenanceState() {
      const { params } = state();
      return {
        method: "lan/state",
        params: {
          ready: initialized,
          activeTurns: params.activeTurns,
          compactions: params.compactions,
        },
      };
    },
    close() {
      closed = true;
      workspace.close();
      for (const i of instances.values()) i.adapter?.close();
    },
    get ready() {
      return state().params.ready;
    },
  };
}
