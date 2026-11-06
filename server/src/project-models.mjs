import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";

export function createProjectModels(directory, legacyDirectory) {
  const path = join(directory, "project-models.json");
  let writing = Promise.resolve();
  async function read() {
    try {
      return JSON.parse(await readFile(path, "utf8"));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      if (legacyDirectory && legacyDirectory !== directory) {
        try {
          return JSON.parse(
            await readFile(
              join(legacyDirectory, "project-models.json"),
              "utf8",
            ),
          );
        } catch (legacyError) {
          if (legacyError.code !== "ENOENT") throw legacyError;
        }
      }
      return {};
    }
  }
  function set({ cwd, model, effort, ifAbsent = false }) {
    if (
      typeof cwd !== "string" ||
      (cwd !== "" && !isAbsolute(cwd)) ||
      typeof model !== "string" ||
      !model ||
      typeof effort !== "string"
    )
      return Promise.reject(new Error("项目目录、模型或思考强度无效"));
    const operation = writing.then(async () => {
      const projects = await read();
      if (ifAbsent && Object.hasOwn(projects, cwd)) return projects;
      const next = { ...projects, [cwd]: { model, effort } };
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const temporary = path + ".tmp";
      await writeFile(temporary, JSON.stringify(next, null, 2) + "\n", {
        mode: 0o600,
      });
      await rename(temporary, path);
      return next;
    });
    writing = operation.catch(() => {});
    return operation;
  }
  return {
    read: () => {
      const operation = writing.then(read);
      writing = operation.catch(() => {});
      return operation;
    },
    set,
  };
}
