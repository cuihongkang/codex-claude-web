import { readdir, writeFile, stat } from "node:fs/promises";
import { join, isAbsolute } from "node:path";
export async function fileRequest(method, params) {
  if (typeof params.path !== "string" || !isAbsolute(params.path))
    throw new Error("请使用绝对路径");
  if (method === "fs/readDirectory") {
    const entries = await readdir(params.path, { withFileTypes: true });
    return {
      entries: await Promise.all(
        entries.map(async (entry) => ({
          fileName: entry.name,
          isDirectory: entry.isSymbolicLink()
            ? await stat(join(params.path, entry.name)).then(
                (s) => s.isDirectory(),
                () => false,
              )
            : entry.isDirectory(),
        })),
      ),
    };
  }
  if (method === "fs/writeFile") {
    await writeFile(params.path, Buffer.from(params.dataBase64, "base64"));
    return {};
  }
  throw new Error(`不支持的方法：${method}`);
}
