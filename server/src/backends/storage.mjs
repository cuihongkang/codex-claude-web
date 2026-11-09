import { mkdir, readFile, writeFile, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

export function createStorage(path, initial) {
  let writing = Promise.resolve();
  async function read() {
    try {
      return JSON.parse(await readFile(path, "utf8"));
    } catch (error) {
      if (error.code === "ENOENT") return structuredClone(initial);
      throw error;
    }
  }
  function update(change) {
    const operation = writing.then(async () => {
      const next = await change(await read());
      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      const temporary = `${path}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, JSON.stringify(next, null, 2) + "\n", {
          mode: 0o600,
          flag: "wx",
        });
        await rename(temporary, path);
      } finally {
        await rm(temporary, { force: true });
      }
      return next;
    });
    writing = operation.catch(() => {});
    return operation;
  }
  return { read: () => writing.then(read), update };
}
