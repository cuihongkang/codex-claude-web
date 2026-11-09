const proxyKeys = [
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "NO_PROXY",
  "http_proxy",
  "https_proxy",
  "all_proxy",
  "no_proxy",
];

export function validateNetworkProxy(input) {
  if (input === undefined) return undefined;
  if (!input || !["system", "off", "http", "https"].includes(input.mode))
    throw new Error("请选择有效的代理协议或关闭代理");
  if (["system", "off"].includes(input.mode)) return { mode: input.mode };
  // 旧版 HTTPS 选项迁移为通过 HTTP CONNECT 访问 HTTPS 网页。
  const mode = "http";
  const host = String(input.host || "").trim();
  const port = Number(input.port);
  if (!host || /[\s/@?#\\]/.test(host)) throw new Error("请填写有效的代理地址");
  let url;
  try {
    url = new URL(`${mode}://${host}:${port}`);
  } catch {
    throw new Error("请填写有效的代理地址和端口");
  }
  if (
    url.hostname !== host.toLowerCase() ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535
  )
    throw new Error("代理端口须为 1～65535 的整数，地址只填写主机名或 IP");
  return { mode, host: url.hostname, port };
}

export function networkProxyEnvironment(proxy) {
  proxy = validateNetworkProxy(proxy);
  if (!proxy || proxy.mode === "system") return {};
  const cleared = Object.fromEntries(proxyKeys.map((key) => [key, ""]));
  if (proxy.mode === "off") return { ...cleared, NODE_USE_ENV_PROXY: "0" };
  const url = `${proxy.mode}://${proxy.host}:${proxy.port}`;
  const bypass = "localhost,127.0.0.1,::1";
  return {
    ...cleared,
    HTTP_PROXY: url,
    HTTPS_PROXY: url,
    http_proxy: url,
    https_proxy: url,
    NO_PROXY: bypass,
    no_proxy: bypass,
    NODE_USE_ENV_PROXY: "1",
  };
}
