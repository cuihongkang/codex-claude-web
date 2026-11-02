import { isCompacting, mergeCompactions } from "../domain/compaction.js";
import { persist } from "../infrastructure/storage.js";
export function createConnection({
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
  getSession,
}) {
  let bootRevision = 0,
    initialized = false,
    projectModelsSupported = false,
    compactionTracking = false;
  function onNotification(m) {
    if (m.method === "lan/projectModels/updated") {
      models.mergeProjectModels(m.params.projects);
      return;
    }
    if (m.method === "lan/state") {
      projectModelsSupported = m.params.projectModels === true;
      const was = get().connected;
      if (!m.params.ready || !was) {
        account.reset();
      }
      compactionTracking = Object.hasOwn(m.params, "compactions");
      const undoneFiles = { ...get().undoneFiles };
      for (const file of m.params.undoneFiles || [])
        undoneFiles[JSON.stringify([file.threadId, file.turnId, file.path])] =
          true;
      persist("cx-undone-files", undoneFiles);
      for (const request of get().questions)
        if (
          !m.params.questions.some(
            (next) => String(next.id) === String(request.id),
          )
        )
          messages.recordInputRequest(request);
      set({
        undoneFiles,
        ...(!get().cwd && m.params.defaultCwd
          ? { cwd: m.params.defaultCwd }
          : {}),
        defaultCwd: m.params.defaultCwd,
        projectlessRoot: m.params.projectlessRoot || "",
        connected: m.params.ready,
        ...(!m.params.ready && { usageLoading: false }),
        serverVersion: m.params.version || null,
        active: m.params.activeTurns,
        compactions: mergeCompactions(get().compactions, m.params.compactions),
        questions: m.params.questions,
        terminals: m.params.terminals || {},
      });
      const terminalId = localStorage.getItem("cx-terminal");
      if (m.params.terminals?.[terminalId]?.running === false)
        events.closeTerminal(terminalId);
      emit(m);
      if (m.params.ready)
        for (const [threadId, entry] of Object.entries(get().compactions))
          if (isCompacting(entry))
            compaction.refreshCompaction(threadId).catch(() => {});
      if (m.params.ready && !was) boot();
      return;
    }
    events.handle(m);
    emit(m);
  }
  function onRequest(m) {
    set({
      questions: [
        ...get().questions.filter((q) => String(q.id) !== String(m.id)),
        m,
      ],
    });
  }
  function onResponse(p, m, error) {
    if (error) {
      const archived = /^(?:session|thread)\s+(\S+)\s+is archived\b/i.exec(
        error.message,
      );
      if (p.threadId && archived?.[1] === p.threadId) {
        error.archivedThreadId = p.threadId;
        if (
          p.opening === navigation.opening ||
          (get().threadAccess?.threadId || get().current?.id) !== p.threadId
        )
          catalog.syncArchivedThread(p.threadId);
      }
    } else {
      if (p.method === "thread/turns/list" && m.result?.data)
        records.recordTurnTimings(p.threadId, m.result.data);
    }
  }
  function onClose(event, connection) {
    models.disconnect();
    bootRevision++;
    account.reset();
    set({
      connected: false,
      usageLoading: false,
      compactions: Object.fromEntries(
        Object.entries(get().compactions).map(([id, entry]) => [
          id,
          isCompacting(entry)
            ? {
                ...entry,
                status: "reconnecting",
                error: "连接中断，重连后将核对整理结果。",
              }
            : entry,
        ]),
      ),
    });
    if (event?.code === 4401) {
      getSession().applySession({ authenticated: false });
      return;
    }
    const reconnect = async () => {
      if (
        transport.connection === connection &&
        !get().connected &&
        get().auth?.authenticated
      ) {
        await getSession().checkSession();
        if (transport.connection === connection && get().auth?.authenticated)
          setTimeout(reconnect, 1500);
      }
    };
    setTimeout(reconnect, 1500);
  }
  async function boot() {
    const revision = ++bootRevision;
    const accountEpoch = account.revision;
    const epoch = navigation.opening;
    const id = get().current?.id || localStorage.getItem("cx-current");
    const current = () => revision === bootRevision && get().connected;
    try {
      const [modelList, accountResult, config] = await Promise.all([
        rpc("model/list"),
        rpc("account/read", { refreshToken: false }),
        rpc("config/read", { includeLayers: false }),
        projectModelsSupported
          ? models.syncProjectModels().catch(report)
          : Promise.resolve(),
      ]);
      if (!current()) return;
      const cfg = config.config || {};
      models.configure({
        model:
          cfg.model || modelList.data.find((m) => m.isDefault)?.model || "",
        effort: cfg.model_reasoning_effort || "",
      });
      set({
        models: modelList.data,
        ...(accountEpoch === account.revision && {
          account: accountResult.account,
        }),
        ...models.projectModelSelection(
          get().cwd,
          get().projectless,
          {
            model: get().model || models.defaults.model,
            effort: get().effort || models.defaults.effort,
          },
          modelList.data,
        ),
        serviceTier:
          get().serviceTier === undefined
            ? (cfg.service_tier ?? null)
            : get().serviceTier,
        booting: false,
      });
      await catalog.loadThreads();
      if (!current()) return;
      // 初始化只恢复启动时的选择，保留期间新建、发送和切换的对话。
      if (epoch === navigation.opening && !get().busy) {
        if (id && get().current?.id === id && !get().loading)
          await Promise.all([
            navigation.loadHistory(epoch),
            navigation.refreshThreadAccess({ background: true }),
          ]);
        else if (id) await navigation.openThread(id);
        else if (!get().current)
          set({ draft: localStorage.getItem("cx-draft-new") || "" });
      }
      if (!current()) return;
      if (!initialized) {
        initialized = true;
        loadSkills().catch(() => {});
      }
    } catch (e) {
      if (!current()) return;
      set({ booting: false });
      if (epoch === navigation.opening) report(e);
    }
  }
  function reset() {
    bootRevision++;
    account.reset();
    models.disconnect();
  }

  return {
    onNotification,
    onRequest,
    onResponse,
    onClose,
    reset,
    get revision() {
      return bootRevision;
    },
    hasTracking: () => compactionTracking,
  };
}
