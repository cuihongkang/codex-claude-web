export function selectedModel(state) {
  return state.models.find(
    (model) =>
      model.model === state.model &&
      (model.providerId || "codex") === (state.providerId || "codex"),
  );
}
export function providerModels(providers, nativeModels) {
  return [
    ...nativeModels.map((model) => ({ ...model, providerId: "codex" })),
    ...providers
      .filter((p) => !p.builtin)
      .flatMap((provider) =>
        provider.models.map((model) => ({
          id: provider.id + ":" + model.id,
          model: model.id,
          displayName: model.id,
          description: provider.name,
          providerId: provider.id,
          supportedReasoningEfforts: [],
          defaultReasoningEffort: "",
          supportedServiceTiers: [],
        })),
      ),
  ];
}
export function threadModelSelection(thread, fallback) {
  if (!thread.providerId) return null;
  return {
    providerId: thread.providerId,
    model: thread.model || fallback.model,
    effort: thread.reasoningEffort || "",
  };
}
