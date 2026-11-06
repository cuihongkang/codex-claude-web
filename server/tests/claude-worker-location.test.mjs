import test from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { mkdtemp, chmod, mkdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  prepareWorkerDirectory,
  verifyWorkerSocket,
} from "../src/backends/claude/worker-location.mjs";

test("Claude IPC accepts a private user socket and rejects shared or substituted paths", async () => {
  const root = await mkdtemp(join(tmpdir(), "claude-ipc-permissions-"));
  const directory = join(root, "private"),
    socketPath = join(directory, "worker.sock");
  let server;
  try {
    await prepareWorkerDirectory(directory);
    server = net.createServer();
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(socketPath, resolve);
    });
    await chmod(socketPath, 0o600);
    await verifyWorkerSocket(socketPath);
    await chmod(socketPath, 0o666);
    await assert.rejects(verifyWorkerSocket(socketPath), /0600/);
    await chmod(socketPath, 0o600);
    const alias = join(root, "alias.sock");
    await symlink(socketPath, alias);
    await assert.rejects(verifyWorkerSocket(alias), /0600/);
    const shared = join(root, "shared");
    await mkdir(shared);
    await chmod(shared, 0o755);
    await assert.rejects(prepareWorkerDirectory(shared), /0700/);
    const linked = join(root, "linked");
    await symlink(directory, linked);
    await assert.rejects(prepareWorkerDirectory(linked), /0700/);
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
});
