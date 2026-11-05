import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function readConfig(env = process.env) {
  const port = Number(env.PORT || 8766);
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    throw new Error("PORT 必须为 0 到 65535 之间的整数");
  const upstreamUrl = env.CODEX_APP_SERVER_URL || "ws://127.0.0.1:8765";
  if (!["ws:", "wss:"].includes(new URL(upstreamUrl).protocol))
    throw new Error("CODEX_APP_SERVER_URL 必须是 WebSocket 地址");
  const codexHome = resolve(env.CODEX_HOME || join(homedir(), ".codex"));
  const backend = new URL(upstreamUrl);
  if (
    backend.protocol === "ws:" &&
    !["127.0.0.1", "localhost", "[::1]"].includes(backend.hostname)
  )
    throw new Error("跨主机 CODEX_APP_SERVER_URL 必须使用 wss://");
  if (!!env.TLS_CERT !== !!env.TLS_KEY)
    throw new Error("TLS_CERT 与 TLS_KEY 必须同时配置");
  const sessionDays = Number(env.AUTH_SESSION_DAYS || 30);
  if (!Number.isInteger(sessionDays) || sessionDays < 1 || sessionDays > 90)
    throw new Error("AUTH_SESSION_DAYS 必须是 1 到 90 之间的整数");
  const pamService = env.AUTH_PAM_SERVICE || "login";
  if (!/^[a-zA-Z0-9_-]+$/.test(pamService))
    throw new Error("AUTH_PAM_SERVICE 必须是 PAM 服务名称");
  return {
    sessionDays,
    pamService,
    pamtesterPath: env.AUTH_PAMTESTER
      ? resolve(env.AUTH_PAMTESTER)
      : "pamtester",
    tlsCert: env.TLS_CERT ? resolve(env.TLS_CERT) : null,
    tlsKey: env.TLS_KEY ? resolve(env.TLS_KEY) : null,
    host: env.HOST || "0.0.0.0",
    port,
    upstreamUrl,
    codexHome,
    projectlessRoot: join(codexHome, "codex-web", "workspaces"),
    defaultCwd: resolve(env.DEFAULT_CWD || homedir()),
    staticDir: env.STATIC_DIR
      ? resolve(env.STATIC_DIR)
      : fileURLToPath(new URL("../../client/dist/", import.meta.url)),
  };
}
