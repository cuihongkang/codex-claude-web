import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createAdapterSettings } from "./adapter-settings.mjs";
import { createModelGateway } from "./gateway.mjs";
import { createContextStorage } from "./context-storage.mjs";

export async function createPersistentAdapter({ codexHome, port = 8767 }) {
  const settings = createAdapterSettings(codexHome, port);
  const context = createContextStorage(codexHome);
  const registry = {
    async get(id) {
      const data = JSON.parse(
        await readFile(join(codexHome, "codex-web", "providers.json"), "utf8"),
      );
      const provider = data.providers.find((p) => p.id === id);
      if (!provider || provider.protocol !== "chat")
        throw new Error("Chat 供应商配置不存在：" + id);
      return provider;
    },
  };
  const gateway = createModelGateway(registry, {
    token: await settings.token(),
    port,
    context,
  });
  await gateway.start();
  return gateway;
}
