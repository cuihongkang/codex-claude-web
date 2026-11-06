import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { mkdir, lstat } from "node:fs/promises";

export function workerLocation(backend) {
  const key = createHash("sha256")
    .update(resolve(backend.stateDir))
    .digest("hex")
    .slice(0, 20);
  const directory = join(
    process.env.XDG_RUNTIME_DIR || tmpdir(),
    `claudex-web-claude-${process.getuid()}`,
  );
  return {
    directory,
    socket: join(directory, `${key}.sock`),
    unit: `claudex-web-claude-${key}`,
  };
}
export async function prepareWorkerDirectory(directory) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const info = await lstat(directory);
  if (!info.isDirectory() || info.uid !== process.getuid() || info.mode & 0o077)
    throw new Error("Claude IPC 目录必须由当前用户持有并使用0700权限。");
}
export async function verifyWorkerSocket(path) {
  const info = await lstat(path);
  if (!info.isSocket() || info.uid !== process.getuid() || info.mode & 0o077)
    throw new Error("Claude IPC socket 必须由当前用户持有并使用0600权限。");
}
