import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileRequest } from "../src/workspace/files.mjs";

test("附件上传保留压缩包及其他二进制原始字节，隔离同名文件并限制权限", async () => {
  const directory = await mkdtemp(join(tmpdir(), "attachment-test-"));
  try {
    const bytes = Buffer.from([80, 75, 3, 4, 0, 255, 128, 1]);
    const upload = () =>
      fileRequest(
        "fs/uploadAttachment",
        { name: "../archive.zip", dataBase64: bytes.toString("base64") },
        directory,
      );
    const first = await upload();
    const second = await upload();
    assert.notEqual(first.path, second.path);
    assert.ok(first.path.startsWith(join(directory, "attachments") + "/"));
    assert.deepEqual(await readFile(first.path), bytes);
    assert.equal((await stat(first.path)).mode & 0o777, 0o600);
    assert.equal((await stat(join(first.path, ".."))).mode & 0o777, 0o700);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
