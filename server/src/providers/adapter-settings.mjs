import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export function createAdapterSettings(codexHome, port = 8767) {
  const directory = join(codexHome, "codex-web", "model-adapter");
  return {
    url: (id) => `http://127.0.0.1:${port}/${id}/v1`,
    async token() {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const path = join(directory, "token");
      try {
        await writeFile(path, randomBytes(32).toString("hex"), {
          mode: 0o600,
          flag: "wx",
        });
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
      }
      return (await readFile(path, "utf8")).trim();
    },
  };
}
