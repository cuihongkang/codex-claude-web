import test from "node:test";
import assert from "node:assert/strict";
import {
  claudeAccountIdentity,
  claudeUsageSnapshot,
  createClaudeAccount,
} from "../src/backends/claude/account.mjs";

test("Claude原生订阅、API和自定义供应商按实际身份提供账户信息", () => {
  const subscription = claudeAccountIdentity({
    email: "person@example.test",
    organization: "Research",
    subscriptionType: "max",
    tokenSource: "oauth",
    apiProvider: "firstParty",
  });
  assert.equal(subscription.type, "claude");
  assert.equal(subscription.name, "person@example.test");
  assert.equal(subscription.planType, "max");
  assert.equal(subscription.usageSupported, true);
  const api = claudeAccountIdentity({
    apiKeySource: "apiKeyHelper",
    apiProvider: "firstParty",
  });
  assert.equal(api.type, "apiKey");
  assert.equal(api.usageSupported, false);
  const external = claudeAccountIdentity(
    { email: "stale@example.test", subscriptionType: "max" },
    { id: "custom", name: "My provider", apiKey: "secret" },
  );
  assert.equal(external.type, "provider");
  assert.equal(external.providerName, "My provider");
  assert.equal(external.email, undefined);
  assert.equal(external.apiKey, undefined);
  assert.equal(external.usageSupported, false);
  for (const identity of [
    {},
    { tokenSource: "none", apiProvider: "firstParty" },
    { subscriptionType: "max", apiProvider: "firstParty" },
  ])
    assert.equal(claudeAccountIdentity(identity), null);
});

test("原生get_usage数据保留真实窗口、模型范围和货币额外用量", () => {
  const snapshot = claudeUsageSnapshot(
    {
      rate_limits_available: true,
      rate_limits: {
        five_hour: { utilization: 27.5, resets_at: "2026-11-06T12:00:00Z" },
        seven_day: { utilization: 35, resets_at: null },
        model_scoped: [
          {
            display_name: "Fable",
            utilization: 81,
            resets_at: "2026-11-12T00:00:00Z",
          },
        ],
        extra_usage: {
          is_enabled: true,
          monthly_limit: null,
          used_credits: 1850,
          currency: "USD",
          utilization: null,
        },
      },
    },
    { subscriptionType: "max" },
  );
  assert.equal(snapshot.rateLimits.windows.length, 3);
  assert.equal(snapshot.rateLimits.windows[0].usedPercent, 27.5);
  assert.equal(
    snapshot.rateLimits.windows[0].resetsAt,
    Date.parse("2026-11-06T12:00:00Z") / 1000,
  );
  assert.equal(snapshot.rateLimits.windows[0].windowDurationMins, 300);
  assert.equal(snapshot.rateLimits.windows[2].label, "Fable周额度");
  assert.equal(snapshot.rateLimits.extraUsage.used, 1850);
  assert.equal(snapshot.rateLimits.extraUsage.limit, null);
  assert.equal(snapshot.rateLimits.extraUsage.unit, "minor");
  assert.equal(snapshot.rateLimits.credits, undefined);
  assert.equal(snapshot.rateLimits.planType, "max");
});

test("原生配额不可用、空窗口及仅额外用量分别保留原生含义", () => {
  assert.equal(
    claudeUsageSnapshot({ rate_limits_available: false, rate_limits: null })
      .availability,
    "unavailable",
  );
  const empty = claudeUsageSnapshot({
    rate_limits_available: true,
    rate_limits: {},
  });
  assert.equal(empty.availability, "available");
  assert.deepEqual(empty.rateLimits.windows, []);
  const extra = claudeUsageSnapshot({
    rate_limits_available: true,
    rate_limits: {
      extra_usage: { is_enabled: false, used_credits: 0, monthly_limit: 0 },
    },
  });
  assert.equal(extra.availability, "available");
  assert.equal(extra.rateLimits.extraUsage.currency, null);
  assert.equal(extra.rateLimits.extraUsage.used, 0);
});

test("供应商身份读取不借用原生登录资料，原生读取采用所属工作目录", async () => {
  const calls = [];
  const service = createClaudeAccount({
    backend: { id: "claude" },
    providers: {
      get: async (_id, providerId) =>
        providerId ? { id: providerId, name: "External" } : null,
    },
    catalogue: {
      read: async (context) => {
        calls.push(context);
        return {
          account: {
            email: "native@example.test",
            subscriptionType: "pro",
            tokenSource: "oauth",
            apiProvider: "firstParty",
          },
        };
      },
    },
  });
  const external = await service.read({ cwd: "/project", providerId: "other" });
  assert.equal(external.account.name, "External");
  assert.equal(calls.length, 0);
  assert.deepEqual(
    await service.rateLimits({ cwd: "/project", providerId: "other" }),
    { rateLimits: null, availability: "external", providerId: "other" },
  );
  assert.equal(calls.length, 0);
  const native = await service.read({ cwd: "/project", threadId: "native" });
  assert.equal(native.account.email, "native@example.test");
  assert.equal(native.account.usageSupported, true);
  assert.equal(calls[0].cwd, "/project");
  assert.equal(calls[0].threadId, "native");
  service.close();
});

test("未登录的原生目录返回空账户并停止订阅额度读取", async () => {
  const service = createClaudeAccount({
    backend: { id: "claude" },
    providers: { get: async () => null },
    catalogue: {
      read: async () => ({
        account: { tokenSource: "none", apiProvider: "firstParty" },
      }),
      usage: async () => assert.fail("未登录时不得查询订阅额度"),
    },
  });
  assert.deepEqual(await service.read({ cwd: "/project" }), {
    account: null,
    usageSupported: false,
    requiresOpenaiAuth: false,
  });
  assert.deepEqual(await service.rateLimits({ cwd: "/project" }), {
    rateLimits: null,
    availability: "unavailable",
  });
});
