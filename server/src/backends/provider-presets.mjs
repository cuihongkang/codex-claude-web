// 默认供应商统一使用现有 Messages 运行时；新增服务在此登记连接与模型信息。
export const providerPresets = [
  {
    id: "deepseek",
    backendId: "claude",
    name: "DeepSeek",
    icon: "deepseek",
    protocol: "messages",
    baseUrl: "https://api.deepseek.com/anthropic",
    models: ["deepseek-flash", "deepseek-v4-pro"],
    modelAliases: {
      "deepseek-flash": "DeepSeek Flash",
      "deepseek-v4-pro": "DeepSeek V4 Pro",
    },
    // https://api-docs.deepseek.com/api/list-models/
    modelCapabilities: Object.fromEntries(
      ["deepseek-flash", "deepseek-v4-pro"].map((model) => [
        model,
        {
          contextWindow: 1048576,
          supportedEffortLevels: ["low", "high", "max"],
          supportsAdaptiveThinking: true,
          supportsFastMode: false,
        },
      ]),
    ),
  },
];

export function configuredProviders(saved) {
  return [
    ...providerPresets.map((preset) => {
      const provider = saved.find((p) => p.id === preset.id);
      return {
        ...preset,
        apiKey: provider?.apiKey || "",
        preset: true,
        enabled: Boolean(provider?.apiKey?.trim()),
      };
    }),
    ...saved.filter(
      (provider) => !providerPresets.some((p) => p.id === provider.id),
    ),
  ];
}
