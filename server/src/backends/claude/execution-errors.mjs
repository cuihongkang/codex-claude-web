export function executionError(error) {
  const details = error?.message || String(error);
  if (
    /System message must be at the beginning|Jinja (?:Exception|Error)|template.*(?:error|exception)/i.test(
      details,
    )
  )
    return {
      code: "providerProtocol",
      message: "供应商无法处理当前请求格式，请检查接口协议配置后重试。",
      details,
      retryable: true,
    };
  if (/\b(?:401|403)\b|authentication_error|invalid.*api.?key/i.test(details))
    return {
      code: "authentication",
      message: "供应商认证失败，请检查凭据和访问权限后重试。",
      details,
      retryable: true,
    };
  if (/\b429\b|rate_limit_error/i.test(details))
    return {
      code: "rateLimit",
      message: "供应商请求额度已达限制，请稍后重试。",
      details,
      retryable: true,
    };
  if (/ECONNREFUSED|ETIMEDOUT|fetch failed|connection error/i.test(details))
    return {
      code: "connection",
      message: "暂时无法连接供应商，请检查服务状态后重试。",
      details,
      retryable: true,
    };
  const status = /^API Error:\s*(\d{3})\b/.exec(details)?.[1];
  if (status)
    return {
      code: "providerRequest",
      message: `供应商请求失败（HTTP ${status}），请检查模型与接口配置后重试。`,
      details,
      retryable: true,
    };
  return { code: "execution", message: details, retryable: true };
}
