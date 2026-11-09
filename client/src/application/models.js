import {
  modelServiceTiers,
  resolveServiceTier,
} from "../domain/service-tier.js";
import { compatibleEffort } from "../domain/model-preferences.js";
import { saved, persist } from "../infrastructure/storage.js";
import { uid } from "../domain/format.js";
export function createModelPreferences({ get, set, rpc, transport, report }) {
  const storageKey = (name, id = get().backendId) =>
    !id || id === "codex" ? name : `${name}-${id}`;
  let defaultModelSelection = { model: "", effort: "" };
  let modelSelectionRevision = 0;
  let projectModelsRemote = false;
  const projectModelsWriting = new Map();
  function selectModel(model) {
    const tier = resolveServiceTier(get().serviceTier, model);
    const previous = get().models.find((entry) => entry.model === get().model);
    set({
      model: model.model,
      effort: compatibleEffort(
        get().effort || previous?.defaultReasoningEffort,
        model,
      ),
      serviceTier: modelServiceTiers(model).some((option) => option.id === tier)
        ? tier
        : null,
    });
    rememberModelSelection();
  }
  function selectEffort(effort) {
    set({ effort });
    rememberModelSelection();
  }
  function rememberModelSelection() {
    if (!get().model) return;
    modelSelectionRevision++;
    const key = get().projectless ? "" : get().cwd;
    const model = get().models.find((entry) => entry.model === get().model);
    const selection = {
      model: get().model,
      effort: get().effort || model?.defaultReasoningEffort || "",
    };
    persist(storageKey("cx-project-models"), {
      ...saved(storageKey("cx-project-models"), {}),
      [key]: selection,
    });
    persist(storageKey("cx-project-models-pending"), {
      ...saved(storageKey("cx-project-models-pending"), {}),
      [key]: { selection, id: uid() },
    });
    flushProjectModels().catch(report);
  }
  function mergeProjectModels(projects) {
    const pending = saved(storageKey("cx-project-models-pending"), {});
    persist(storageKey("cx-project-models"), {
      ...projects,
      ...Object.fromEntries(
        Object.entries(pending).map(([key, entry]) => [key, entry.selection]),
      ),
    });
  }
  function flushProjectModels() {
    if (!projectModelsRemote || !get().connected) return Promise.resolve();
    const backendId = get().backendId;
    if (projectModelsWriting.has(backendId))
      return projectModelsWriting.get(backendId);
    const connection = transport.connection;
    const writing = (async () => {
      while (
        get().connected &&
        get().backendId === backendId &&
        transport.connection === connection
      ) {
        const [entry] = Object.entries(
          saved(storageKey("cx-project-models-pending"), {}),
        );
        if (!entry) return;
        const [cwd, pending] = entry;
        const result = await rpc("lan/projectModels/set", {
          backendId,
          cwd,
          ...pending.selection,
          ifAbsent: pending.ifAbsent || false,
        });
        if (
          get().backendId !== backendId ||
          transport.connection !== connection
        )
          return;
        const remaining = saved(storageKey("cx-project-models-pending"), {});
        if (remaining[cwd]?.id === pending.id) delete remaining[cwd];
        persist(storageKey("cx-project-models-pending"), remaining);
        mergeProjectModels(result.projects);
      }
    })()
      .catch((error) => {
        throw new Error("项目模型设置保存失败：" + error.message);
      })
      .finally(() => {
        if (projectModelsWriting.get(backendId) === writing)
          projectModelsWriting.delete(backendId);
      });
    projectModelsWriting.set(backendId, writing);
    return writing;
  }
  async function syncProjectModels() {
    const connection = transport.connection;
    const backendId = get().backendId;
    const result = await rpc("lan/projectModels/read", { backendId });
    if (connection !== transport.connection || backendId !== get().backendId)
      return;
    projectModelsRemote = Boolean(result.projects);
    if (!projectModelsRemote) return;
    const pending = saved(storageKey("cx-project-models-pending"), {});
    for (const [key, selection] of Object.entries(
      saved(storageKey("cx-project-models"), {}),
    ))
      if (
        !Object.hasOwn(result.projects, key) &&
        !Object.hasOwn(pending, key) &&
        selection.model
      )
        pending[key] = { selection, id: uid(), ifAbsent: true };
    persist(storageKey("cx-project-models-pending"), pending);
    mergeProjectModels(result.projects);
    await flushProjectModels();
  }
  function projectModelSelection(
    cwd,
    projectless,
    fallback,
    models = get().models,
  ) {
    const preferences = saved(storageKey("cx-project-models"), {});
    const key = projectless ? "" : cwd;
    const selection = Object.hasOwn(preferences, key)
      ? preferences[key]
      : fallback;
    const model =
      models.find((entry) => entry.model === selection.model) ||
      models.find((entry) => entry.model === fallback.model) ||
      models.find((entry) => entry.isDefault) ||
      models[0];
    return {
      model: model?.model || "",
      effort: compatibleEffort(
        model?.model === selection.model ? selection.effort : fallback.effort,
        model || { supportedReasoningEfforts: [] },
      ),
    };
  }

  return {
    selectModel,
    selectEffort,
    rememberModelSelection,
    mergeProjectModels,
    syncProjectModels,
    projectModelSelection,
    get revision() {
      return modelSelectionRevision;
    },
    get defaults() {
      return defaultModelSelection;
    },
    configure(selection) {
      defaultModelSelection = selection;
    },
    disconnect() {
      projectModelsRemote = false;
    },
  };
}
