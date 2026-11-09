import { constants } from "node:fs";
import {
  chmod,
  copyFile,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

export function productDirectories(env = process.env) {
  const base = env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return {
    configDir: resolve(env.CLAUDEX_WEB_CONFIG_DIR || join(base, "claudex-web")),
    legacyConfigDir: resolve(
      env.CODEX_WEB_CONFIG_DIR || join(base, "codex-web"),
    ),
  };
}

// 首次升级以完整目录快照迁移网页配置；原目录与已存在的新配置保持原样。
export async function migrateProductConfig({ configDir, legacyConfigDir }) {
  if (!legacyConfigDir || configDir === legacyConfigDir) return;
  try {
    await stat(configDir);
    return;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  try {
    const source = await stat(legacyConfigDir);
    if (!source.isDirectory()) throw new Error("旧网页配置路径必须是目录");
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  await mkdir(dirname(configDir), { recursive: true, mode: 0o700 });
  const temporary = await mkdtemp(
    join(dirname(configDir), ".claudex-migrate-"),
  );
  const snapshot = join(temporary, "config");
  try {
    await cp(legacyConfigDir, snapshot, {
      recursive: true,
      mode: constants.COPYFILE_EXCL,
      errorOnExist: true,
      force: false,
      filter: async (path) => !(await lstat(path)).isSocket(),
    });
    await chmod(snapshot, 0o700);
    const oldIndex = join(
      snapshot,
      "backends",
      "claude",
      "codex-web-index.json",
    );
    try {
      await copyFile(
        oldIndex,
        join(snapshot, "backends", "claude", "claudex-web-index.json"),
        constants.COPYFILE_EXCL,
      );
    } catch (error) {
      if (!["ENOENT", "EEXIST"].includes(error.code)) throw error;
    }
    await rm(oldIndex, { force: true });
    try {
      await rename(snapshot, configDir);
    } catch (error) {
      if (!["EEXIST", "ENOTEMPTY"].includes(error.code)) throw error;
    }
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
