import { providerModels } from "../domain/providers.js";

export function createProviders({ get, set, rpc, transport }) {
  function apply(providers) {
    const native = get().models.filter(
      (model) => !model.providerId || model.providerId === "codex",
    );
    set({ providers, models: providerModels(providers, native) });
  }
  async function save(provider) {
    const connection = transport.connection;
    const result = await rpc("lan/providers/set", provider);
    if (connection === transport.connection) apply(result.providers);
  }
  async function remove(id) {
    const connection = transport.connection;
    const result = await rpc("lan/providers/remove", { id });
    if (connection === transport.connection) apply(result.providers);
  }
  return { apply, save, remove };
}
