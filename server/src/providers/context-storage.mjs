import { mkdir, readFile, writeFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";

export function createContextStorage(codexHome) {
  const directory = join(codexHome, "codex-web", "model-adapter", "context");
  function path(id) {
    if (!/^[a-zA-Z0-9-]{1,80}$/.test(id || ""))
      throw new Error("缺少有效的 Codex 对话标识。");
    return join(directory, id + ".json");
  }
  async function write(id, value) {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const file = path(id);
    await writeFile(file + ".tmp", JSON.stringify(value), { mode: 0o600 });
    await rename(file + ".tmp", file);
  }
  return {
    save: (id, summary) => write(id, { summary }),
    remove: (id) => rm(path(id), { force: true }),
    async read(id, compacted) {
      let value;
      try {
        value = JSON.parse(await readFile(path(id), "utf8"));
      } catch (error) {
        if (error.code === "ENOENT") return null;
        throw error;
      }
      const hash = createHash("sha256")
        .update(JSON.stringify(compacted))
        .digest("hex");
      if (value.hash && value.hash !== hash) return null;
      if (!value.hash) await write(id, { ...value, hash });
      return value.summary;
    },
  };
}
