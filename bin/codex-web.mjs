#!/usr/bin/env node
// Codex Web 命令入口，配置与运行时数据独立于 npm 安装目录。
import { execFileSync } from "node:child_process";
import { constants } from "node:fs";
import { copyFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import { readConfig } from "../server/src/config.mjs";
import { readVersion } from "../server/src/version.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const configDir = resolve(
  process.env.CODEX_WEB_CONFIG_DIR ||
    join(
      process.env.XDG_CONFIG_HOME || join(homedir(), ".config"),
      "codex-web",
    ),
);
const args = process.argv.slice(2);
const command = args.join(" ") || "start";

async function main() {
  if (["--help", "-h", "help"].includes(command)) {
    console.log(`Codex Web — Codex 与 Claude Code 的浏览器客户端

用法：codex-web [命令]
  start                      前台启动网页服务（默认命令）
  backend                    前台启动 Codex app-server
  config init                创建用户配置，保留已有配置
  service install            安装并启动 Linux systemd 用户服务
  service status             查看网页与后端服务状态
  service start              启动网页服务及其 Codex 后端
  service stop               停止网页服务
  service restart            重启网页服务
  service restart-when-idle   等待任务与上下文整理结束后重启网页服务
  --version                  显示版本与开发构建标识
  version --json             显示完整版本、提交和构建信息

配置目录：${configDir}
可用 CODEX_WEB_CONFIG_DIR 指定配置目录。
安装 npm 包后执行 codex-web service install 可启用后台访问。`);
    return;
  }
  if (["--version", "-v"].includes(command)) {
    console.log(readVersion().displayVersion);
    return;
  }
  if (command === "version --json") {
    console.log(JSON.stringify(readVersion(), null, 2));
    return;
  }
  if (
    ![
      "start",
      "backend",
      "config init",
      "service install",
      "service status",
      "service start",
      "service stop",
      "service restart",
      "service restart-when-idle",
    ].includes(command)
  )
    throw new Error(`未知命令：${command}。使用 codex-web --help 查看用法。`);
  if (command.startsWith("service ") && process.platform !== "linux")
    throw new Error("后台服务管理需要 Linux 和 systemd 用户服务。");

  await mkdir(configDir, { recursive: true, mode: 0o700 });
  if (["config init", "service install"].includes(command)) {
    try {
      await copyFile(
        join(root, ".env.example"),
        join(configDir, ".env"),
        constants.COPYFILE_EXCL,
      );
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
  }
  process.env.CODEX_WEB_CONFIG_DIR = configDir;
  process.chdir(configDir);
  try {
    loadEnvFile(join(configDir, ".env"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  switch (command) {
    case "config init":
      console.log(`用户配置：${join(configDir, ".env")}`);
      break;
    case "start":
      await import("../server/src/server.mjs");
      break;
    case "backend":
      await import("../scripts/start-backend.mjs");
      break;
    case "service install": {
      const { installServices } =
        await import("../scripts/install-services.mjs");
      await installServices({ configDir, cli: true });
      console.log('开机运行用户服务：loginctl enable-linger "$USER"');
      const config = readConfig();
      console.log(
        `HTTPS 健康检查：https://127.0.0.1:${config.port}/healthz；证书：${config.tlsCert || join(config.configDir, "tls", "certificate.pem")}`,
      );
      break;
    }
    case "service restart-when-idle":
      await import("../scripts/restart-when-idle.mjs");
      break;
    default: {
      const action = args[1];
      const units = ["codex-lan-web.service"];
      if (action === "status")
        units.push("codex-app-server.service", "--no-pager");
      execFileSync("systemctl", ["--user", action, ...units], {
        stdio: "inherit",
      });
    }
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = typeof error.status === "number" ? error.status || 1 : 1;
});
