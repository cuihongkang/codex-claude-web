import test from "node:test";
import assert from "node:assert/strict";
import { createAccount } from "../src/application/account.js";
import {
  quotaWindows,
  quotaLabel,
  quotaShortLabel,
  quotaExtraUsageText,
  mergeUsageUpdate,
} from "../src/domain/account-usage.js";

test("原生订阅按全部真实窗口展示，货币用量与点数独立", () => {
  const windows = [
    {
      usedPercent: 0,
      label: "会话额度",
      shortLabel: "当前",
      windowDurationMins: null,
    },
    {
      usedPercent: 50,
      label: "周额度",
      shortLabel: "周",
      windowDurationMins: 10080,
    },
    {
      usedPercent: 75,
      label: "模型周额度",
      shortLabel: "周",
      windowDurationMins: 10080,
    },
  ];
  const usage = {
    rateLimits: {
      windows,
      extraUsage: {
        enabled: true,
        used: 125,
        limit: 1000,
        currency: "USD",
        unit: "minor",
      },
    },
  };
  assert.deepEqual(quotaWindows(usage), windows);
  assert.equal(quotaLabel(null, windows[0].label), "会话额度");
  assert.equal(quotaShortLabel(null, windows[0].shortLabel), "当前");
  assert.equal(quotaExtraUsageText(usage), "US$1.25 / US$10.00");
  assert.deepEqual(
    mergeUsageUpdate(usage, { windows: windows.slice(0, 1) }).rateLimits
      .windows,
    windows.slice(0, 1),
  );
});

test("供应商切换后旧额度响应失效，新目标保留独立的加载与结果", async () => {
  let state = {
    connected: true,
    backendId: "claude",
    providerId: "one",
    cwd: "/fixture",
    account: { type: "claude", usageSupported: true },
  };
  const pending = [];
  const client = createAccount({
    get: () => state,
    set: (patch) => {
      state = { ...state, ...patch };
    },
    transport: { connection: {} },
    rpc: (_method, params) =>
      new Promise((resolve) => pending.push({ params, resolve })),
  });
  const first = client.refreshUsage();
  state = { ...state, providerId: "two" };
  const second = client.refreshUsage();
  assert.equal(pending.length, 2);
  assert.deepEqual(
    pending.map((p) => p.params.providerId),
    ["one", "two"],
  );
  pending[0].resolve({ rateLimits: { windows: [{ usedPercent: 90 }] } });
  await first;
  assert.equal(state.usage, undefined);
  assert.equal(state.usageLoading, true);
  pending[1].resolve({ rateLimits: { windows: [{ usedPercent: 20 }] } });
  await second;
  assert.equal(state.usage.rateLimits.windows[0].usedPercent, 20);
  assert.equal(state.usageLoading, false);
});

test("相同原生账户跨项目读取独立额度，旧项目身份响应保持隔离", async () => {
  let state = {
    connected: true,
    backendId: "claude",
    providerId: "",
    cwd: "/first",
    account: { type: "claude", usageSupported: true },
  };
  const pending = [];
  const client = createAccount({
    get: () => state,
    set: (patch) => {
      state = { ...state, ...patch };
    },
    transport: { connection: {} },
    rpc: (method, params) =>
      new Promise((resolve) => pending.push({ method, params, resolve })),
  });
  const oldUsage = client.refreshUsage();
  client.handle({ method: "account/updated" });
  state = { ...state, cwd: "/second" };
  const newUsage = client.refreshUsage();
  assert.equal(pending.length, 3);
  pending[0].resolve({ rateLimits: { windows: [{ usedPercent: 90 }] } });
  pending[1].resolve({ account: { type: "claude", email: "old-project" } });
  await oldUsage;
  await Promise.resolve();
  assert.equal(state.account, null);
  assert.equal(state.usage, null);
  pending[2].resolve({ rateLimits: { windows: [{ usedPercent: 10 }] } });
  await newUsage;
  assert.equal(state.usage.rateLimits.windows[0].usedPercent, 10);
  assert.equal(state.usageLoading, false);
});
