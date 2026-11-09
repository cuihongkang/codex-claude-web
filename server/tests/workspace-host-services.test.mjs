import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWorkspace } from "../src/workspace/service.mjs";

test("网页主机服务保存文件、读取目录和执行交互终端命令，文件读取与搜索交原生后端", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "workspace-host-"));
  const workspace = createWorkspace({ broadcast() {} });
  t.after(() => workspace.close());
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "source"));
  assert.equal(workspace.handles("fs/readFile"), false);
  assert.equal(workspace.handles("fuzzyFileSearch"), false);
  await workspace.request("fs/writeFile", {
    path: join(root, "source/example.txt"),
    dataBase64: Buffer.from("已保存的正文").toString("base64"),
  });
  assert.equal(
    await readFile(join(root, "source/example.txt"), "utf8"),
    "已保存的正文",
  );
  const directory = await workspace.request("fs/readDirectory", {
    path: join(root, "source"),
  });
  assert.deepEqual(directory.entries, [
    { fileName: "example.txt", isDirectory: false },
  ]);
  const command = await workspace.request("command/exec", {
    cwd: root,
    command: [process.execPath, "-e", "process.stdout.write('终端输出')"],
  });
  assert.equal(command.exitCode, 0);
  assert.equal(command.stdout, "终端输出");
});
