import assert from "node:assert/strict";
import test from "node:test";
import {
  mergeUsageUpdate,
  quotaLabel,
  quotaPlan,
  quotaResetText,
  quotaShortLabel,
  quotaSnapshot,
  quotaWindows,
} from "../src/domain/account-usage.js";

const weekly = {
  usedPercent: 41,
  windowDurationMins: 10080,
  resetsAt: 1900000000,
};
const limits = {
  limitId: "codex",
  primary: weekly,
  secondary: null,
  planType: "pro",
  credits: { hasCredits: true, unlimited: false, balance: "200" },
};

test("额度按实际窗口显示，兼容 Pro 单周窗口和 Plus 双窗口", () => {
  assert.deepEqual(quotaWindows({ rateLimits: limits }), [weekly]);
  const fiveHours = {
    usedPercent: 12,
    windowDurationMins: 300,
    resetsAt: 1800000000,
  };
  const plus = {
    rateLimits: { primary: fiveHours, secondary: weekly, planType: "plus" },
  };
  assert.deepEqual(quotaWindows(plus), [fiveHours, weekly]);
  assert.equal(quotaLabel(10080), "周额度");
  assert.equal(quotaLabel(300), "5 小时额度");
  assert.equal(quotaLabel(1440), "1 天额度");
  assert.equal(quotaLabel(30), "30 分钟额度");
  assert.equal(quotaLabel(null), "额度");
  assert.equal(quotaShortLabel(10080), "周");
  assert.equal(quotaShortLabel(300), "5h");
  assert.equal(quotaPlan(null, { rateLimits: limits }), "Pro");
  assert.equal(quotaPlan({ planType: "pro" }, plus), "Plus");
  assert.equal(quotaPlan({ type: "apiKey" }, null), "API Key");
  assert.deepEqual(
    quotaWindows({ rateLimits: { primary: { usedPercent: null } } }),
    [],
  );
});

test("稀疏通知保留窗口和方案元数据，零用量与 false 正常更新", () => {
  const usage = {
    rateLimits: limits,
    rateLimitsByLimitId: { codex: limits },
    accountId: "fixture-account",
  };
  const merged = mergeUsageUpdate(usage, {
    limitId: "codex",
    primary: { usedPercent: 0, windowDurationMins: null, resetsAt: null },
    secondary: null,
    planType: null,
    credits: { hasCredits: false, unlimited: null, balance: null },
  });
  assert.deepEqual(merged.rateLimits.primary, { ...weekly, usedPercent: 0 });
  assert.equal(merged.rateLimits.planType, "pro");
  assert.deepEqual(merged.rateLimits.credits, {
    ...limits.credits,
    hasCredits: false,
  });
  assert.equal(merged.accountId, usage.accountId);
  assert.equal(merged.rateLimits, merged.rateLimitsByLimitId.codex);
  const unnamed = mergeUsageUpdate(merged, {
    limitId: null,
    primary: { usedPercent: 35 },
    planType: null,
  });
  assert.equal(quotaSnapshot(unnamed).primary.usedPercent, 35);
  assert.equal(unnamed.rateLimits, unnamed.rateLimitsByLimitId.codex);
  assert.equal(quotaPlan(null, unnamed), "Pro");
  assert.equal(usage.rateLimits.primary.usedPercent, 41);
  const other = mergeUsageUpdate(merged, {
    limitId: "other-model",
    primary: { usedPercent: 98 },
    planType: null,
  });
  assert.equal(quotaSnapshot(other), merged.rateLimits);
  assert.equal(
    other.rateLimitsByLimitId["other-model"].primary.usedPercent,
    98,
  );
  const legacy = mergeUsageUpdate(
    { rateLimits: limits },
    { primary: { usedPercent: 50 }, planType: null },
  );
  assert.deepEqual(legacy.rateLimits.primary, { ...weekly, usedPercent: 50 });
});

test("重置倒计时按天小时与分钟更新，过期窗口等待后端更新", () => {
  const now = new Date(2026, 9, 30, 10, 0).getTime();
  assert.equal(quotaResetText(null, now), "");
  assert.match(
    quotaResetText(new Date(2026, 9, 30, 15, 30).getTime() / 1000, now),
    /^5 小时 30 分钟后重置$/,
  );
  assert.match(
    quotaResetText(new Date(2026, 9, 31, 15, 30).getTime() / 1000, now),
    /^1 天 5 小时后重置$/,
  );
  assert.match(
    quotaResetText(new Date(2026, 10, 5, 15, 30).getTime() / 1000, now),
    /^6 天 5 小时后重置$/,
  );
  assert.equal(quotaResetText(now / 1000 + 86400, now), "1 天后重置");
  assert.equal(quotaResetText(now / 1000 + 3600, now), "1 小时后重置");
  assert.equal(quotaResetText(now / 1000 + 60, now), "1 分钟后重置");
  assert.equal(quotaResetText(now / 1000 + 30, now), "不到 1 分钟后重置");
  assert.equal(quotaResetText(now / 1000, now), "正在更新重置额度…");
});
