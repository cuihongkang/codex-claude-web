import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import { mkdtemp, writeFile, rm, mkdir, open } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serveFile } from "../src/file-content.mjs";

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "claudex-web-media-test-"));
  const path = join(directory, "训练 #1.MP4");
  const bytes = Buffer.from(Array.from({ length: 256 }, (_, i) => i));
  await writeFile(path, bytes);
  const server = http.createServer(serveFile);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  });
  const origin = `http://127.0.0.1:${server.address().port}/api/files`;
  const url = (path) => origin + "?" + new URLSearchParams({ path });
  return { directory, path, bytes, url, origin };
}

test("本地视频按原始字节读取，支持中文、空格、特殊字符和大小写扩展名", async (t) => {
  const { path, bytes, url } = await fixture(t);
  const response = await fetch(url(path));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "video/mp4");
  assert.equal(response.headers.get("content-length"), "256");
  assert.equal(response.headers.get("accept-ranges"), "bytes");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
  const head = await fetch(url(path), {
    method: "HEAD",
    headers: { Range: "bytes=10-20" },
  });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get("content-length"), "256");
  assert.equal((await head.arrayBuffer()).byteLength, 0);
});

test("视频单段 Range 支持定位、开放末尾与后缀，越界请求返回完整大小", async (t) => {
  const { path, bytes, url } = await fixture(t);
  for (const [range, start, end] of [
    ["bytes=10-19", 10, 19],
    ["bytes=200-", 200, 255],
    ["bytes=-20", 236, 255],
    ["bytes=250-999", 250, 255],
    ["bytes=-999", 0, 255],
  ]) {
    const response = await fetch(url(path), { headers: { Range: range } });
    assert.equal(response.status, 206, range);
    assert.equal(
      response.headers.get("content-range"),
      `bytes ${start}-${end}/256`,
    );
    assert.equal(
      response.headers.get("content-length"),
      String(end - start + 1),
    );
    assert.deepEqual(
      Buffer.from(await response.arrayBuffer()),
      bytes.subarray(start, end + 1),
    );
  }
  for (const range of [
    "bytes=256-",
    "bytes=30-20",
    "bytes=-0",
    "bytes=-",
    "bytes=0-1,3-4",
    "items=0-3",
    "bytes=9007199254740992-",
    "bytes=abc-def",
  ]) {
    const response = await fetch(url(path), { headers: { Range: range } });
    assert.equal(response.status, 416, range);
    assert.equal(response.headers.get("content-range"), "bytes */256");
    await response.arrayBuffer();
  }
});

test("无效路径、缺失文件与目录返回独立错误，空文件支持元数据请求", async (t) => {
  const { directory, path, url, origin } = await fixture(t);
  const directoryPath = join(directory, "directory.mp4");
  await mkdir(directoryPath);
  const empty = join(directory, "empty.webm");
  await writeFile(empty, "");
  for (const [address, status] of [
    [origin, 400],
    [url("relative.mp4"), 400],
    [url("/invalid\0.mp4"), 400],
    [url(join(directory, "missing.mp4")), 404],
    [url(directoryPath), 404],
  ]) {
    const response = await fetch(address);
    assert.equal(response.status, status, address);
    await response.arrayBuffer();
  }
  const post = await fetch(url(path), { method: "POST" });
  assert.equal(post.status, 405);
  assert.equal(post.headers.get("allow"), "GET, HEAD");
  await post.arrayBuffer();
  const response = await fetch(url(empty));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "video/webm");
  assert.equal((await response.arrayBuffer()).byteLength, 0);
  const range = await fetch(url(empty), { headers: { Range: "bytes=0-" } });
  assert.equal(range.status, 416);
  assert.equal(range.headers.get("content-range"), "bytes */0");
});

test("图片、音频与 PDF 返回预览类型，其他文件及显式下载强制附件并保留原始字节", async (t) => {
  const { directory, url } = await fixture(t);
  for (const [name, mime, disposition] of [
    ["picture.AVIF", "image/avif", "inline"],
    ["picture.BMP", "image/bmp", "inline"],
    ["picture.ICO", "image/x-icon", "inline"],
    ["sound.FLAC", "audio/flac", "inline"],
    ["sound.mp3", "audio/mpeg", "inline"],
    ["说明 #1.PDF", "application/pdf", "inline"],
    ["data.zip", "application/octet-stream", "attachment"],
    ["document.docx", "application/octet-stream", "attachment"],
    ["table.xlsx", "application/octet-stream", "attachment"],
    ["slides.pptx", "application/octet-stream", "attachment"],
    ["unknown.data", "application/octet-stream", "attachment"],
    ["page.html", "application/octet-stream", "attachment"],
  ]) {
    const path = join(directory, name);
    const bytes = Buffer.from([255, 0, 1, 2, 3]);
    await writeFile(path, bytes);
    const response = await fetch(url(path));
    assert.equal(response.status, 200, name);
    assert.equal(response.headers.get("content-type"), mime, name);
    assert.equal(
      response.headers.get("content-disposition"),
      `${disposition}; filename*=UTF-8''${encodeURIComponent(name)}`,
    );
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes, name);
    const download = await fetch(url(path) + "&download=1");
    assert(
      download.headers.get("content-disposition").startsWith("attachment;"),
      name,
    );
    assert.deepEqual(Buffer.from(await download.arrayBuffer()), bytes, name);
  }
});

test("大视频读取指定分段，浏览器取消请求后可继续读取其他片段", async (t) => {
  const { directory, url } = await fixture(t);
  const path = join(directory, "large.mp4");
  const file = await open(path, "w");
  await file.truncate(128 * 1024 * 1024);
  await file.write(Buffer.from("tail"), 0, 4, 128 * 1024 * 1024 - 4);
  await file.close();
  const response = await fetch(url(path));
  const reader = response.body.getReader();
  assert((await reader.read()).value.length > 0);
  await reader.cancel();
  const tail = await fetch(url(path), { headers: { Range: "bytes=-4" } });
  assert.equal(tail.status, 206);
  assert.equal(await tail.text(), "tail");
});
