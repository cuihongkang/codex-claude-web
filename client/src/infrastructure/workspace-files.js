// Claude Code's native read_file control caps complete files at 10,000,000 bytes.
const nativeReadBytes = 10_000_000;

export async function readWorkspaceFile({
  path,
  backendId,
  cwd,
  providerId,
  threadId,
  rpc,
  request = globalThis.fetch,
}) {
  if (backendId === "claude") {
    const url = "/api/files?" + new URLSearchParams({ path });
    const metadata = await request(url, {
      method: "HEAD",
      credentials: "same-origin",
    });
    if (!metadata.ok)
      throw new Error(`文件读取失败（HTTP ${metadata.status}）`);
    const length = metadata.headers.get("Content-Length");
    const size = length === null ? NaN : Number(length);
    if (!Number.isSafeInteger(size) || size < 0)
      throw new Error("文件长度信息无效");
    if (size > nativeReadBytes) {
      const response = await request(url, { credentials: "same-origin" });
      if (!response.ok)
        throw new Error(`文件读取失败（HTTP ${response.status}）`);
      return new Uint8Array(await response.arrayBuffer());
    }
  }
  const { dataBase64 } = await rpc("fs/readFile", {
    path,
    ...(backendId === "claude" && {
      cwd,
      providerId,
      ...(threadId && { threadId }),
    }),
  });
  return Uint8Array.from(atob(dataBase64), (character) =>
    character.charCodeAt(0),
  );
}
