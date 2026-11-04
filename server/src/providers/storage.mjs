import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { dirname } from "node:path";

export function createProviderStorage(path) {
  let writing = Promise.resolve();
  let data;
  async function read() {
    if (!data) {
      try {
        data = JSON.parse(await readFile(path, "utf8"));
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
        data = { providers: [], threads: {} };
      }
    }
    return data;
  }
  function update(change) {
    const operation = writing.then(async () => {
      const next = change(await read());
      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      await writeFile(path + ".tmp", JSON.stringify(next, null, 2) + "\n", {
        mode: 0o600,
      });
      await rename(path + ".tmp", path);
      data = next;
      return next;
    });
    writing = operation.catch(() => {});
    return operation;
  }
  return { read: () => writing.then(read), update };
}
