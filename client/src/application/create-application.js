import { createBackends } from "./backends.js";
import { resourceTarget } from "../../../shared/backend-identity.mjs";
import { createAppState } from "./state.js";
import { createRpcClient } from "../infrastructure/rpc-client.js";
import { createModelPreferences } from "./models.js";
import { createThreadRecords } from "./thread-records.js";
import { createThreadNavigation } from "./thread-navigation.js";
import { createThreadCatalog } from "./thread-catalog.js";
import { createMessages } from "./messages.js";
import { createAccount } from "./account.js";
import { createCompaction } from "./compaction.js";
import { createEvents } from "./events.js";
import { createConnection } from "./connection.js";
import { createSession } from "./session.js";
import { createNotifications } from "./notifications.js";
import { persist } from "../infrastructure/storage.js";

// 依赖在此处组装；控制器通过显式接口协作，各自持有请求版本和生命周期状态。
export function createApplication() {
  const store = createAppState();
  const { get, set } = store;
  const listeners = new Set();
  const emit = (event) => {
    for (const listener of listeners) listener(event);
  };
  const onEvent = (listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };
  function report(error) {
    if (error?.archivedThreadId) return;
    set({ error: error?.message || String(error) });
  }
  function notice(text) {
    set({ notice: text });
    setTimeout(() => {
      if (get().notice === text) set({ notice: "" });
    }, 4000);
  }
  async function copy(text) {
    try {
      if (navigator.clipboard?.writeText)
        await navigator.clipboard.writeText(text);
      else {
        const input = document.createElement("textarea");
        input.value = text;
        input.style.position = "fixed";
        input.style.opacity = "0";
        document.body.append(input);
        input.select();
        const ok = document.execCommand("copy");
        input.remove();
        if (!ok) throw new Error("浏览器未允许复制，请长按文本选择复制。");
      }
      notice("已复制");
    } catch (e) {
      report(e);
    }
  }
  function openSubAgent(agent) {
    set({
      panel: "agent",
      panelAgent: { ...agent, parentId: get().current?.id },
      contextOpen: true,
    });
  }
  function setTheme(theme) {
    set({ theme });
    persist("cx-theme", theme);
  }
  let skillsRevision = 0;
  async function loadSkills() {
    const revision = ++skillsRevision;
    const { cwd, backendId, providerId, current } = get();
    const result = await rpc("skills/list", {
      cwds: [cwd],
      cwd,
      backendId,
      providerId,
      ...(current?.id && { threadId: current.id }),
    });
    if (
      revision !== skillsRevision ||
      get().cwd !== cwd ||
      get().backendId !== backendId ||
      get().providerId !== providerId ||
      get().current?.id !== current?.id
    )
      return;
    set({
      skills: result.data.flatMap((entry) => entry.skills || []),
      nativeCommands: result.commands || [],
      nativeAgents: result.agents || [],
    });
  }
  const transport = createRpcClient({
    isConnected: () => get().connected,
    authenticated: () => get().auth?.authenticated,
    requestContext: () => ({ opening: navigation.opening }),
    onNotification: (message) => connection.onNotification(message),
    onRequest: (message) => connection.onRequest(message),
    onResponse: (request, message, error) =>
      connection.onResponse(request, message, error),
    onClose: (event, socket) => connection.onClose(event, socket),
  });
  const rpc = (method, params = {}, timeout) => {
    if (!get().backends.length) return transport.rpc(method, params, timeout);
    const backendId =
      params.backendId ||
      (params.threadId
        ? resourceTarget(params.threadId).backendId
        : get().backendId);
    const global =
      method === "thread/list" ||
      method.startsWith("lan/backends/") ||
      method.startsWith("lan/providers/");
    return transport.rpc(
      method,
      { ...(!global && { backendId }), ...params },
      timeout,
    );
  };
  const models = createModelPreferences({ get, set, rpc, transport, report });
  const backends = createBackends({
    transport,
    get,
    set,
    rpc,
    models,
    report,
    onSelectionChanged: () => account.handle({ method: "account/updated" }),
  });
  const records = createThreadRecords({ get, set, rpc });
  const navigation = createThreadNavigation({
    get,
    set,
    rpc,
    transport,
    models,
    records,
    getConnectionRevision: () => connection.revision,
    activateBackend: backends.activateBackend,
    selectProvider: backends.selectProvider,
  });
  const catalog = createThreadCatalog({
    get,
    set,
    rpc,
    records,
    navigation,
    report,
    notice,
  });
  const messages = createMessages({
    setThreadMode: store.setThreadMode,
    get,
    set,
    rpc,
    transport,
    navigation,
    catalog,
    records,
    models,
    report,
  });
  const account = createAccount({ get, set, rpc, transport });
  const compaction = createCompaction({
    get,
    set,
    rpc,
    transport,
    navigation,
    records,
    hasTracking: () => connection.hasTracking(),
  });
  const notifications = createNotifications({
    get,
    set,
    subscribe: store.subscribe,
    navigation,
    rpc,
  });
  const events = createEvents({
    get,
    set,
    records,
    catalog,
    messages,
    account,
    report,
    notice,
    notifications,
  });
  const connection = createConnection({
    get,
    set,
    rpc,
    transport,
    models,
    records,
    navigation,
    catalog,
    messages,
    account,
    compaction,
    events,
    emit,
    report,
    loadSkills,
    activateBackend: backends.activateBackend,
    getSession: () => session,
  });
  const session = createSession({ get, set, transport, connection });
  return {
    store,
    rpc,
    onEvent,
    report,
    notice,
    copy,
    openSubAgent,
    setTheme,
    loadSkills,
    setReadingThread: records.setReadingThread,
    selectModel: models.selectModel,
    selectEffort: models.selectEffort,
    syncProjectModels: models.syncProjectModels,
    refreshUsage: account.refreshUsage,
    setCompletionNotifications: notifications.setEnabled,
    startNotifications: notifications.start,
    ...backends,
    ...navigation,
    ...catalog,
    ...messages,
    ...compaction,
    ...session,
  };
}
