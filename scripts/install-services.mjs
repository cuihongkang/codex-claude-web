import { createBackendConfiguration } from "../server/src/backends/configuration.mjs";
import { execFileSync } from "node:child_process";
import { access, copyFile, mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { migrateProductConfig } from "../server/src/product-config.mjs";
import { readConfig } from "../server/src/config.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
export async function installServices({ configDir = root, cli = false } = {}) {
  if (process.platform !== "linux")
    throw new Error("后台服务安装需要 Linux 和 systemd 用户服务。");
  execFileSync("systemctl", ["--user", "show-environment"], { stdio: "pipe" });
  const config = readConfig();
  await migrateProductConfig(config);
  const configured = await createBackendConfiguration(config).read();
  const codexBackend = configured.backends.find(
    (b) => b.id === "codex" && b.type === "codex" && b.enabled,
  );
  const manageCodex =
    codexBackend &&
    ["localhost", "127.0.0.1", "[::1]"].includes(
      new URL(codexBackend.url).hostname,
    );
  const userUnits = join(
    process.env.XDG_CONFIG_HOME || join(homedir(), ".config"),
    "systemd/user",
  );
  const backups = join(
    process.env.XDG_STATE_HOME || join(homedir(), ".local/state"),
    "claudex-web/service-backups",
    new Date().toISOString().replaceAll(":", "-"),
  );
  const quote = (value) => JSON.stringify(value.replaceAll("%", "%%"));
  const unitPath = (value) =>
    value
      .replaceAll("%", "%%")
      .replace(
        /[\s\\"]/g,
        (char) => "\\x" + char.charCodeAt(0).toString(16).padStart(2, "0"),
      );
  const exists = async (path) =>
    access(path).then(
      () => true,
      () => false,
    );
  await access(join(root, "client/dist/index.html"));
  await mkdir(userUnits, { recursive: true });
  await mkdir(backups, { recursive: true });

  const backendPath = join(userUnits, "codex-app-server.service");
  if (manageCodex && !(await exists(backendPath))) {
    const codex = execFileSync("which", [codexBackend.executable || "codex"], {
      encoding: "utf8",
    }).trim();
    await writeFile(
      backendPath,
      `[Unit]
Description=Codex app-server
After=network.target

[Service]
Type=simple
WorkingDirectory=${unitPath(homedir())}
Environment=${quote("PATH=" + dirname(process.execPath) + ":" + process.env.PATH)}
EnvironmentFile=-${unitPath(join(configDir, ".env.backend"))}
ExecStart=${quote(codex)} -c thread_unload_delay_secs=0 app-server --listen ${quote(codexBackend.url)}
Restart=on-failure
RestartSec=5
UMask=0077

[Install]
WantedBy=default.target
`,
    );
  } else if (manageCodex)
    console.log(
      "保留现有 codex-app-server.service 的登录环境、代理和启动配置。",
    );

  const webPath = join(userUnits, "claudex-web.service");
  if (await exists(webPath))
    await copyFile(webPath, join(backups, "claudex-web.service"));
  await writeFile(
    webPath,
    `[Unit]
Description=Claudex Web
${manageCodex ? "Wants=codex-app-server.service\nAfter=network.target codex-app-server.service" : "After=network.target"}

[Service]
Type=simple
WorkingDirectory=${unitPath(configDir)}
Environment=${quote("PATH=" + dirname(process.execPath) + ":" + process.env.PATH)}
${cli ? `Environment=${quote("CLAUDEX_WEB_CONFIG_DIR=" + configDir)}\n` : ""}EnvironmentFile=-${unitPath(join(configDir, ".env"))}
ExecStart=${quote(process.execPath)} ${quote(join(root, cli ? "bin/claudex-web.mjs" : "server/src/server.mjs"))}${cli ? " start" : ""}
Restart=on-failure
RestartSec=5
UMask=0077

[Install]
WantedBy=default.target
`,
  );
  execFileSync(
    "systemd-analyze",
    ["--user", "verify", webPath, ...(manageCodex ? [backendPath] : [])],
    {
      stdio: "inherit",
    },
  );
  execFileSync("systemctl", ["--user", "daemon-reload"], { stdio: "inherit" });
  execFileSync(
    "systemctl",
    [
      "--user",
      "enable",
      "--now",
      ...(manageCodex ? ["codex-app-server.service"] : []),
      "claudex-web.service",
    ],
    { stdio: "inherit" },
  );
  console.log(`服务配置已安装，旧网页服务配置备份在 ${backups}`);
  console.log(
    `正在运行的网页服务会继续运行；需要切换桥接服务代码时执行 ${cli ? "claudex-web service restart-when-idle" : "npm run service:restart-when-idle"}。`,
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await installServices();
