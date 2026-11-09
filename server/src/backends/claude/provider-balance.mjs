// 只向官方服务发送对应供应商的凭据，第三方代理保留独立计费语义。
export function supportsProviderBalance(provider) {
  return provider?.id === "deepseek" && provider.preset === true;
}

export async function readProviderBalance(provider, fetchBalance = fetch) {
  const response = await fetchBalance("https://api.deepseek.com/user/balance", {
    headers: { Authorization: `Bearer ${provider.apiKey}` },
    signal: AbortSignal.timeout(15000),
    redirect: "error",
  });
  if (!response.ok)
    throw new Error(`DeepSeek 余额查询失败（HTTP ${response.status}）`);
  const data = await response.json();
  if (
    typeof data.is_available !== "boolean" ||
    !Array.isArray(data.balance_infos) ||
    data.balance_infos.some(
      (row) =>
        !["CNY", "USD"].includes(row.currency) ||
        [row.total_balance, row.granted_balance, row.topped_up_balance].some(
          (value) =>
            typeof value !== "string" ||
            !value.trim() ||
            !Number.isFinite(Number(value)),
        ),
    )
  )
    throw new Error("DeepSeek 余额响应格式无效");
  return {
    rateLimits: {
      limitId: "deepseek",
      windows: [],
      balances: data.balance_infos,
      balanceAvailable: data.is_available,
    },
    availability: "available",
    providerId: provider.id,
  };
}
