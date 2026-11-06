import { execFile } from "node:child_process";
import { access, realpath } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, delimiter, join } from "node:path";
import { homedir } from "node:os";
import { promisify } from "node:util";

const execute = promisify(execFile);
const packages = {
  codex: "@openai/codex",
  claude: "@anthropic-ai/claude-code",
};
export async function findCli(id) {
  if (!packages[id]) throw new Error("未知后端");
  const directories = [
    dirname(process.execPath),
    ...(process.env.PATH || "").split(delimiter),
    join(homedir(), ".local", "bin"),
  ];
  for (const directory of new Set(directories.filter(Boolean))) {
    const path = join(directory, id);
    try {
      await access(path, constants.X_OK);
      return await realpath(path);
    } catch (error) {
      if (!["ENOENT", "EACCES", "ENOTDIR"].includes(error.code)) throw error;
    }
  }
  throw new Error(
    `未找到 ${id}，请点击一键安装，或执行 npm install -g ${packages[id]}`,
  );
}

export function createCliInstallation({
  run = execute,
  locate = findCli,
  fetchVersion = latestVersion,
  changed = () => {},
} = {}) {
  let timer;
  const states = new Map();
  const pending = new Map();
  function state(id) {
    return (
      states.get(id) || {
        checking: true,
        installed: null,
        currentVersion: "",
        latestVersion: "",
      }
    );
  }
  function patch(id, values) {
    states.set(id, { ...state(id), ...values });
    changed();
  }
  function refresh(id) {
    if (!packages[id]) throw new Error("未知后端");
    if (pending.has(id)) return pending.get(id);
    const operation = (async () => {
      patch(id, { checking: true, error: "", latestError: "" });
      const [local, latest] = await Promise.allSettled([
        (async () => {
          const executable = await locate(id);
          const { stdout } = await run(executable, ["--version"], {
            timeout: 10000,
          });
          const version = stdout.match(/\b\d+\.\d+\.\d+(?:-[\w.-]+)?\b/)?.[0];
          if (!version) throw new Error("无法识别 CLI 版本：" + stdout.trim());
          return { executable, currentVersion: version };
        })(),
        fetchVersion(packages[id]),
      ]);
      patch(id, {
        checking: false,
        installed: local.status === "fulfilled",
        ...(local.status === "fulfilled"
          ? local.value
          : { currentVersion: "", error: local.reason.message }),
        ...(latest.status === "fulfilled"
          ? { latestVersion: latest.value }
          : { latestError: latest.reason.message }),
      });
      return state(id);
    })().finally(() => pending.delete(id));
    pending.set(id, operation);
    return operation;
  }
  async function install(id) {
    if (!packages[id]) throw new Error("未知后端");
    patch(id, { installing: true, installError: "" });
    try {
      const npm = join(dirname(process.execPath), "npm");
      await run(npm, ["install", "--global", `${packages[id]}@latest`], {
        timeout: 300000,
        maxBuffer: 4 * 1024 * 1024,
        env: {
          ...process.env,
          PATH: `${dirname(process.execPath)}${delimiter}${process.env.PATH || ""}`,
        },
      });
      if (pending.has(id)) await pending.get(id);
      await refresh(id);
      if (!state(id).installed) throw new Error(state(id).error);
    } catch (error) {
      patch(id, {
        installError: `npm 安装失败：${error.stderr?.trim() || error.message}`,
      });
      throw error;
    } finally {
      patch(id, { installing: false });
    }
  }
  function start() {
    if (timer) return;
    const check = () => {
      for (const id of Object.keys(packages)) refresh(id).catch(() => {});
    };
    timer = setInterval(check, 60 * 60 * 1000);
    timer.unref();
    check();
  }
  function close() {
    clearInterval(timer);
    timer = undefined;
  }
  return { state, refresh, install, start, close };
}

async function latestVersion(packageName) {
  const response = await fetch(
    `https://registry.npmjs.org/${encodeURIComponent(packageName)}/latest`,
    { signal: AbortSignal.timeout(15000) },
  );
  if (!response.ok)
    throw new Error(`最新版本查询失败（HTTP ${response.status}）`);
  const data = await response.json();
  if (typeof data.version !== "string") throw new Error("npm 版本响应格式无效");
  return data.version;
}
