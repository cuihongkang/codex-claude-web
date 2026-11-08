import test from "node:test";
import assert from "node:assert/strict";
import { attachmentInputs } from "../src/application/attachments.js";

test("二进制附件上传失败保留原文件，重试后复用路径，提交原生文件引用", async () => {
  const attachment = {
    name: "archive.zip",
    dataUrl: "data:application/zip;base64,UEsDBAD/gAE=",
  };
  let attempts = 0;
  const rpc = async (method, params) => {
    assert.equal(method, "fs/uploadAttachment");
    assert.equal(params.dataBase64, "UEsDBAD/gAE=");
    if (++attempts === 1) throw new Error("上传失败");
    return { path: "/uploads/archive.zip" };
  };
  await assert.rejects(attachmentInputs([attachment], rpc), /上传失败/);
  assert.equal(attachment.path, undefined);
  const first = await attachmentInputs([attachment], rpc);
  assert.deepEqual(await attachmentInputs([attachment], rpc), first);
  assert.equal(attempts, 2);
  assert.equal(first[0].type, "text");
  assert.match(first[0].text, /引用本机文件：\/uploads\/archive.zip/);
  assert.equal(attachment.dataUrl, "data:application/zip;base64,UEsDBAD/gAE=");
});
