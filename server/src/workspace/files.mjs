import { readdir, writeFile, stat, mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join, isAbsolute, basename } from "node:path";
export async function fileRequest(method, params, configDir) {
  if (method === "fs/uploadAttachment") {
    if (
      !configDir ||
      typeof params.name !== "string" ||
      typeof params.dataBase64 !== "string"
    )
      throw new Error("附件上传参数无效");
    const directory = join(configDir, "attachments", randomUUID());
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const path = join(directory, basename(params.name) || "attachment");
    await writeFile(path, Buffer.from(params.dataBase64, "base64"), {
      mode: 0o600,
      flag: "wx",
    });
    return { path };
  }
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
