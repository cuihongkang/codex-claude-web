import {
  modelServiceTiers,
  resolveServiceTier,
} from "../domain/service-tier.js";
import { compatibleEffort } from "../domain/model-preferences.js";
import { saved, persist } from "../infrastructure/storage.js";
import { uid } from "../domain/format.js";
export function createModelPreferences({ get, set, rpc, transport, report }) {
  let defaultModelSelection = { model: "", effort: "" };
  let modelSelectionRevision = 0;
  let projectModelsRemote = false;
  let projectModelsWriting = null;
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
    persist("cx-project-models", {
      ...saved("cx-project-models", {}),
      [key]: selection,
    });
    persist("cx-project-models-pending", {
      ...saved("cx-project-models-pending", {}),
      [key]: { selection, id: uid() },
    });
    flushProjectModels().catch(report);
  }
  function mergeProjectModels(projects) {
    const pending = saved("cx-project-models-pending", {});
    persist("cx-project-models", {
      ...projects,
      ...Object.fromEntries(
        Object.entries(pending).map(([key, entry]) => [key, entry.selection]),
      ),
    });
  }
  function flushProjectModels() {
    if (!projectModelsRemote || !get().connected) return Promise.resolve();
    if (projectModelsWriting) return projectModelsWriting;
    projectModelsWriting = (async () => {
      while (get().connected) {
        const [entry] = Object.entries(saved("cx-project-models-pending", {}));
        if (!entry) return;
        const [cwd, pending] = entry;
        const result = await rpc("lan/projectModels/set", {
          cwd,
          ...pending.selection,
          ifAbsent: pending.ifAbsent || false,
        });
        const remaining = saved("cx-project-models-pending", {});
        if (remaining[cwd]?.id === pending.id) delete remaining[cwd];
        persist("cx-project-models-pending", remaining);
        mergeProjectModels(result.projects);
      }
    })()
      .catch((error) => {
        throw new Error("项目模型设置保存失败：" + error.message);
      })
      .finally(() => {
        projectModelsWriting = null;
      });
    return projectModelsWriting;
  }
  async function syncProjectModels() {
    const connection = transport.connection;
    const result = await rpc("lan/projectModels/read");
    if (connection !== transport.connection) return;
    projectModelsRemote = Boolean(result.projects);
    if (!projectModelsRemote) return;
    const pending = saved("cx-project-models-pending", {});
    for (const [key, selection] of Object.entries(
      saved("cx-project-models", {}),
    ))
      if (
        !Object.hasOwn(result.projects, key) &&
        !Object.hasOwn(pending, key) &&
        selection.model
      )
        pending[key] = { selection, id: uid(), ifAbsent: true };
    persist("cx-project-models-pending", pending);
    mergeProjectModels(result.projects);
    await flushProjectModels();
  }
  function projectModelSelection(
    cwd,
    projectless,
    fallback,
    models = get().models,
  ) {
    const preferences = saved("cx-project-models", {});
    const key = projectless ? "" : cwd;
    const selection = Object.hasOwn(preferences, key)
      ? preferences[key]
      : fallback;
    const model = models.find((entry) => entry.model === selection.model);
    return {
      model: selection.model,
      effort: compatibleEffort(selection.effort, model),
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
