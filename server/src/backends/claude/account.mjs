import {
  supportsProviderBalance,
  readProviderBalance,
} from "./provider-balance.mjs";

export function claudeAccountIdentity(native, provider) {
  if (provider)
    return {
      type: "provider",
      providerId: provider.id,
      providerName: provider.name,
      name: provider.name,
      apiProvider: "configured",
      usageSupported: supportsProviderBalance(provider),
    };
  const hasToken = Boolean(native.tokenSource && native.tokenSource !== "none");
  const hasApiKey = Boolean(
    native.apiKeySource && native.apiKeySource !== "none",
  );
  const type =
    native.apiProvider && native.apiProvider !== "firstParty"
      ? "provider"
      : hasToken
        ? "claude"
        : hasApiKey
          ? "apiKey"
          : null;
  if (!type) return null;
  return {
    ...native,
    type,
    name: native.email || native.organization || "Claude Code",
    planType: native.subscriptionType,
    usageSupported: type === "claude",
  };
}

export function claudeUsageSnapshot(report, account) {
  const source = report?.rate_limits;
  if (!report?.rate_limits_available || !source)
    return { rateLimits: null, availability: "unavailable" };
  const definitions = [
    ["five_hour", "5 小时额度", "5h", 300],
    ["seven_day", "周额度", "周", 10080],
    ["seven_day_oauth_apps", "OAuth 应用周额度", "周", 10080],
    ["seven_day_opus", "Opus 周额度", "周", 10080],
    ["seven_day_sonnet", "Sonnet 周额度", "周", 10080],
  ];
  const rows = definitions
    .filter(([id]) => source[id] != null)
    .map(([id, label, shortLabel, windowDurationMins]) => ({
      id,
      label,
      shortLabel,
      windowDurationMins,
      ...source[id],
    }));
  for (const [index, row] of (source.model_scoped || []).entries())
    rows.push({
      ...row,
      id: "model_scoped:" + index + ":" + row.display_name,
      label: row.display_name + "周额度",
      shortLabel: "周",
      windowDurationMins: 10080,
    });
  const windows = rows.map(({ utilization, resets_at, ...row }) => {
    const parsedReset = resets_at ? Date.parse(resets_at) / 1000 : null;
    return {
      ...row,
      usedPercent: utilization,
      resetsAt: Number.isFinite(parsedReset) ? parsedReset : null,
    };
  });
  const limits = {
    limitId: "claude",
    planType: account?.subscriptionType || account?.planType,
    windows,
    primary: windows[0] || null,
    secondary: windows[1] || null,
    extraUsage: source.extra_usage
      ? {
          enabled: source.extra_usage.is_enabled,
          used: source.extra_usage.used_credits,
          limit: source.extra_usage.monthly_limit,
          currency: source.extra_usage.currency || null,
          unit: "minor",
          utilization: source.extra_usage.utilization,
        }
      : null,
  };
  return {
    rateLimits: limits,
    rateLimitsByLimitId: { claude: limits },
    availability: "available",
  };
}

export function createClaudeAccount({
  backend,
  providers,
  catalogue,
  queries = new Map(),
}) {
  const pending = new Map();
  const contexts = async (params) => {
    const provider = await providers.get(backend.id, params.providerId);
    return {
      provider,
      cwd: params.cwd,
      providerId: provider?.id || "",
      threadId: params.threadId,
    };
  };
  async function read(params = {}) {
    const context = await contexts(params);
    const native = context.provider
      ? {}
      : (await catalogue.read(context)).account;
    const account = claudeAccountIdentity(native || {}, context.provider);
    return {
      account,
      usageSupported: account?.usageSupported === true,
      requiresOpenaiAuth: false,
    };
  }
  async function rateLimits(params = {}) {
    const context = await contexts(params);
    if (context.provider && supportsProviderBalance(context.provider)) {
      const key = context.provider.id + ":" + context.provider.apiKey;
      if (!pending.has(key))
        pending.set(
          key,
          readProviderBalance(context.provider).finally(() =>
            pending.delete(key),
          ),
        );
      return pending.get(key);
    }
    if (context.provider)
      return {
        rateLimits: null,
        availability: "external",
        providerId: context.providerId,
      };
    const identity = (await catalogue.read(context)).account;
    if (!claudeAccountIdentity(identity || {})?.usageSupported)
      return { rateLimits: null, availability: "unavailable" };
    const key = JSON.stringify([context.cwd, identity, context.threadId || ""]);
    if (pending.has(key)) return pending.get(key);
    const request = catalogue
      .usage(context)
      .then((report) => ({
        ...claudeUsageSnapshot(report, identity),
        rateLimitEvents: (context.threadId
          ? [queries.get(context.threadId)].filter(Boolean)
          : [...queries.values()].filter((run) => run.cwd === context.cwd)
        )
          .filter((run) => !run.providerId)
          .flatMap((run) => [...(run.rateLimits?.values() || [])]),
      }))
      .finally(() => pending.delete(key));
    pending.set(key, request);
    return request;
  }

  return {
    read,
    rateLimits,
    close() {},
  };
}
