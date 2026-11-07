import test from "node:test";
import assert from "node:assert/strict";
import {
  readProviderBalance,
  supportsProviderBalance,
} from "../src/backends/claude/provider-balance.mjs";
import { claudeAccountIdentity } from "../src/backends/claude/account.mjs";

test("DeepSeek 官方余额保留币种、零余额与不可用状态，凭据仅用于官方请求", async () => {
  const provider = { id: "deepseek", preset: true, apiKey: "test-key" };
  assert.equal(claudeAccountIdentity({}, provider).usageSupported, true);
  assert.equal(supportsProviderBalance({ id: "custom" }), false);
  const rows = ["CNY", "USD"].map((currency) => ({
    currency,
    total_balance: "0.00",
    granted_balance: "0",
    topped_up_balance: "0",
  }));
  const result = await readProviderBalance(provider, async (url, options) => {
    assert.equal(url, "https://api.deepseek.com/user/balance");
    assert.equal(options.headers.Authorization, "Bearer test-key");
    assert.equal(options.redirect, "error");
    return {
      ok: true,
      json: async () => ({ is_available: false, balance_infos: rows }),
    };
  });
  assert.deepEqual(result.rateLimits.balances, rows);
  assert.equal(result.rateLimits.balanceAvailable, false);
  assert.equal(JSON.stringify(result).includes("test-key"), false);
});

test("余额接口错误及无效响应提供可重试错误", async () => {
  await assert.rejects(
    readProviderBalance({}, async () => ({ ok: false, status: 401 })),
    /HTTP 401/,
  );
  await assert.rejects(
    readProviderBalance({}, async () => ({ ok: true, json: async () => ({}) })),
    /格式无效/,
  );
});
