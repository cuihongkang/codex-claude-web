import { newDraftKey } from "../infrastructure/backend-storage.js";
import { persist, saved } from "../infrastructure/storage.js";
import { compatibleEffort } from "../domain/model-preferences.js";
import { backendEnabled } from "../domain/backend-visibility.js";
import {
  modelServiceTiers,
  resolveServiceTier,
} from "../domain/service-tier.js";
export function createBackends({
  get,
  set,
  rpc,
  models,
  transport,
  report,
  onSelectionChanged = () => {},
}) {
  let revision = 0;
  let selectionRevision = 0;
  const attachments = new Map();
  async function activateBackend(id, choice) {
    if (!get().backends?.length) return;
    const epoch = ++revision;
    if (!backendEnabled(get().backends, id)) {
      models.disconnect();
      set({
        models: [],
        modelChoices: [],
        model: "",
        effort: "",
        serviceTier: null,
        providers: [],
        skills: [],
        nativeCommands: [],
        nativeAgents: [],
        account: null,
        usage: null,
        usageLoading: false,
        usageError: "",
      });
      return;
    }
    const connection = transport?.connection;
    const cwd = get().cwd;
    const current = () =>
      epoch === revision &&
      backendEnabled(get().backends, id) &&
      get().backendId === id &&
      get().cwd === cwd &&
      (!transport || (transport.connection === connection && get().connected));
    const previous = get().backendId || "codex";
    const threadId = previous === id ? get().current?.id : null;
    const threadSelection =
      (choice && {
        model: choice.model,
        providerId: choice.providerId,
        effort: get().effort,
        serviceTier: get().serviceTier,
      }) ||
      (previous === id && (threadId || get().model)
        ? {
            model: get().model,
            effort: get().effort,
            providerId: get().providerId,
            serviceTier: get().serviceTier,
          }
        : null);
    const initialProvider =
      threadSelection?.providerId ?? saved("cx-provider-" + id, "");
    const sameAccount = previous === id && initialProvider === get().providerId;
    const modelRevision = models.revision;
    if (!get().current) {
      localStorage.setItem(newDraftKey(previous), get().draft);
      attachments.set(previous, get().attachments);
    }
    models.disconnect();
    set({
      backendId: id,
      ...(previous !== id && {
        terminalOpen: false,
        contextOpen: false,
        panel: null,
        panelFile: null,
      }),
      ...(!get().current && {
        draft: localStorage.getItem(newDraftKey(id)) || "",
        attachments: attachments.get(id) || [],
      }),
      providers: sameAccount ? get().providers : [],
      providerId: initialProvider,
      models: choice
        ? get().modelChoices.filter(
            (entry) =>
              entry.backendId === choice.backendId &&
              entry.providerId === choice.providerId,
          )
        : sameAccount
          ? get().models
          : [],
      model: "",
      effort: "",
      ...(!sameAccount && {
        account: null,
        usage: null,
        usageError: "",
        usageLoading: false,
      }),
      skills: sameAccount ? get().skills : [],
      nativeCommands: sameAccount ? get().nativeCommands : [],
      nativeAgents: sameAccount ? get().nativeAgents : [],
      serviceTier: null,
      ...threadSelection,
    });
    persist("cx-backend", id);
    const accountProvider = get().providerId;
    const [
      modelResult,
      providerResult,
      accountResult,
      codexResult,
      claudeResult,
      configResult,
    ] = await Promise.allSettled([
      rpc("model/list", {
        backendId: id,
        cwd,
        providerId: get().providerId,
      }),
      rpc("lan/providers/list", { backendId: "claude" }),
      rpc("account/read", {
        backendId: id,
        cwd,
        providerId: get().providerId,
        refreshToken: false,
      }),
      id === "codex"
        ? get().backends.some(
            (backend) => backend.id === "claude" && backend.enabled,
          )
          ? rpc("model/list", { backendId: "claude", cwd })
          : Promise.resolve(null)
        : rpc("model/list", { backendId: "codex", cwd }),
      id === "claude"
        ? rpc("model/list", {
            backendId: "claude",
            providerId: "",
            cwd,
          })
        : Promise.resolve(null),
      rpc("config/read", {
        backendId: id,
        cwd,
        providerId: get().providerId,
        includeLayers: false,
      }),
    ]);
    if (!current()) return;
    if (modelResult.status === "rejected") report(modelResult.reason);
    const nativeModels =
      modelResult.status === "fulfilled" ? modelResult.value.data : [];
    const configured =
      providerResult.status === "fulfilled"
        ? providerResult.value.providers
        : [];
    const catalogues = await Promise.allSettled(
      configured.map((provider) =>
        rpc("model/list", {
          backendId: "claude",
          providerId: provider.id,
          cwd,
        }),
      ),
    );
    if (!current()) return;
    const allProviders = configured.map((provider, index) => ({
      ...provider,
      modelRecords:
        catalogues[index].status === "fulfilled"
          ? catalogues[index].value.data.map((model) => ({
              ...model,
              displayName:
                provider.modelAliases?.[model.model] ||
                model.displayName ||
                model.model,
            }))
          : provider.models.map((model) => ({
              id: model,
              model,
              displayName: provider.modelAliases?.[model] || model,
              supportedReasoningEfforts: [],
            })),
    }));
    const codex = get().backends.find((b) => b.id === id)?.type === "codex";
    const providers = codex ? [] : allProviders;
    const codexModels = codex
      ? nativeModels
      : codexResult.status === "fulfilled"
        ? codexResult.value?.data || []
        : [];
    const modelChoices = [
      ...codexModels.map((model) => ({
        backendId: "codex",
        providerId: "",
        providerName: "ChatGPT",
        ...model,
      })),
      ...((id === "claude" ? claudeResult : codexResult).status === "fulfilled"
        ? (
            (id === "claude" ? claudeResult : codexResult).value?.data || []
          ).map((model) => ({
            ...model,
            backendId: "claude",
            providerId: "",
            providerName: "Claude",
          }))
        : []),
      ...allProviders.flatMap((provider) =>
        provider.modelRecords.map((model) => ({
          ...model,
          backendId: "claude",
          providerId: provider.id,
          providerName: provider.name,
        })),
      ),
    ].filter((choice) =>
      get().backends.some((b) => b.id === choice.backendId && b.enabled),
    );
    const preserveSelection = Boolean(get().model);
    const selected = preserveSelection
      ? get().providerId
      : saved("cx-provider-" + id, "");
    const provider = providers.find((p) => p.id === selected);
    const list =
      provider?.modelRecords ||
      (provider
        ? provider.models.map((model) => ({
            id: model,
            model,
            displayName: provider.modelAliases?.[model] || model,
            supportedReasoningEfforts: [],
          }))
        : id === "claude"
          ? claudeResult.status === "fulfilled"
            ? claudeResult.value?.data || []
            : []
          : nativeModels);
    const model = list.find((m) => m.isDefault)?.model || list[0]?.model || "";
    const selectedModel = list.find((entry) => entry.model === get().model);
    const tier =
      selectedModel && resolveServiceTier(get().serviceTier, selectedModel);
    const config =
      configResult.status === "fulfilled"
        ? configResult.value.config || {}
        : {};
    models.configure({
      model: config.model || model,
      effort: config.model_reasoning_effort || "",
    });
    set({
      providers,
      modelChoices,
      models: list,
      ...(!preserveSelection && {
        providerId: provider?.id || "",
        model,
        effort: "",
        serviceTier: config.service_tier ?? null,
      }),
      ...(preserveSelection &&
        selectedModel && {
          effort: compatibleEffort(get().effort, selectedModel),
          serviceTier: modelServiceTiers(selectedModel).some(
            (option) => option.id === tier,
          )
            ? tier
            : null,
        }),
      ...(get().providerId === accountProvider && {
        account:
          accountResult.status === "fulfilled"
            ? accountResult.value.account
            : sameAccount
              ? get().account
              : null,
      }),
    });
    try {
      await models.syncProjectModels?.();
    } catch (error) {
      if (current()) report(error);
    }
    if (
      current() &&
      !choice &&
      !get().current &&
      models.revision === modelRevision &&
      models.projectModelSelection
    ) {
      set(
        models.projectModelSelection(
          cwd,
          get().projectless,
          models.defaults,
          get().models,
        ),
      );
    }
  }
  function selectProvider(id, choice) {
    id ??= "";
    const changed = id !== get().providerId;
    const provider = get().providers.find((p) => p.id === id);
    if (!provider && id && !choice) return;
    const models =
      provider?.modelRecords ||
      (provider
        ? provider.models.map((model) => ({
            id: model,
            model,
            displayName: provider.modelAliases?.[model] || model,
            supportedReasoningEfforts: [],
          }))
        : get().modelChoices.filter(
            (entry) => entry.backendId === "claude" && entry.providerId === id,
          ));
    set({
      providerId: id,
      models,
      skills: [],
      nativeCommands: [],
      nativeAgents: [],
      ...(changed && {
        account: null,
        usage: null,
        usageError: "",
        usageLoading: false,
      }),
      ...(choice
        ? { model: choice.model }
        : { model: models[0]?.model || "", effort: "" }),
    });
    persist("cx-provider-" + get().backendId, id);
    if (changed) onSelectionChanged();
  }
  async function selectModelChoice(choice) {
    if (!choice) return;
    if (get().busy || get().loading) return;
    if (
      get().active[get().current?.id] &&
      choice.providerId !== get().providerId
    )
      return;
    if (get().current && choice.backendId !== get().backendId) return;
    const selection = ++selectionRevision;
    const threadId = get().current?.id;
    const draft = get().draft;
    const attachments = get().attachments;
    if (choice.backendId !== get().backendId) {
      const activating = activateBackend(choice.backendId, choice);
      persist("cx-provider-" + choice.backendId, choice.providerId);
      models.selectModel(choice);
      set({ draft, attachments });
      localStorage.setItem(newDraftKey(choice.backendId), draft);
      await activating;
      return;
    }
    if (
      selection !== selectionRevision ||
      threadId !== get().current?.id ||
      choice.backendId !== get().backendId
    )
      return;
    if (choice.backendId === "claude" && choice.providerId !== get().providerId)
      selectProvider(choice.providerId, choice);
    models.selectModel(choice);
  }
  async function refreshBackends() {
    const result = await rpc("lan/backends/list");
    set({ backends: result.backends });
    await activateBackend(
      get().backendId || result.backends.find((b) => b.enabled)?.id,
    );
  }
  async function saveBackend(value) {
    await rpc("lan/backends/save", value);
    await refreshBackends();
  }
  async function saveProvider(value) {
    await rpc("lan/providers/save", value);
    await activateBackend(get().backendId);
  }
  return {
    activateBackend,
    selectModelChoice,
    selectProvider,
    refreshBackends,
    saveBackend,
    saveProvider,
    report,
  };
}
