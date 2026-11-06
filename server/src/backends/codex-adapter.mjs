import { createBridge } from "../bridge/create-bridge.mjs";
import { codexCapabilities } from "../../../shared/backend-capabilities.mjs";

export function createCodexAdapter({ backend, config, providers, ...options }) {
  const bridge = createBridge({
    ...options,
    config: { ...config, upstreamUrl: backend.url, codexHome: backend.dataDir },
  });
  return {
    ...bridge,
    capabilities: codexCapabilities,
    receive(client, message) {
      if (!message.method) return bridge.receive(client, message);
      const { providerId, ...params } = message.params || {};
      if (providerId) throw new Error("Codex 使用现有账户与模型配置");
      return bridge.receive(client, { ...message, params });
    },
    get ready() {
      return bridge.ready;
    },
  };
}
