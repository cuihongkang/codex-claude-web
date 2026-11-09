import {
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";

// 只在目标目录尚未建立时迁移网页自有状态，现有配置始终优先。
export async function migrateWebDirectory(config, name, filenames) {
  const target = join(config.configDir, name);
  try {
    await stat(target);
    return;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const legacy = join(config.codexHome, "codex-web", name);
  const files = await Promise.all(
    filenames.map(async (filename) => {
      try {
        return [filename, await readFile(join(legacy, filename))];
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
        return null;
      }
    }),
  );
  if (!files.some(Boolean)) return;
  if (name === "tls" && files.some((file) => !file))
    throw new Error("旧 HTTPS 证书或私钥缺失，请检查原网页证书目录。");
  await mkdir(config.configDir, { recursive: true, mode: 0o700 });
  const temporary = await mkdtemp(join(config.configDir, `.migrate-${name}-`));
  try {
    for (const [filename, bytes] of files.filter(Boolean))
      await writeFile(join(temporary, filename), bytes, { mode: 0o600 });
    try {
      await rename(temporary, target);
    } catch (error) {
      if (!["EEXIST", "ENOTEMPTY"].includes(error.code)) throw error;
    }
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
