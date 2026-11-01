import test from "node:test";
import assert from "node:assert/strict";
import { filePresentation, decodeTextFile } from "../../shared/file-types.mjs";

test("文件预览按大小写无关扩展名分类，代码、配置和无扩展名正文继续编辑", () => {
  for (const [path, kind] of [
    ["/tmp/a.AVIF", "image"],
    ["/tmp/a.BMP", "image"],
    ["/tmp/a.ICO", "image"],
    ["/tmp/a.MP4", "video"],
    ["/tmp/a.mkv", "video"],
    ["/tmp/a.ogg", "audio"],
    ["/tmp/a.FLAC", "audio"],
    ["/tmp/a.PDF", "pdf"],
    ["/tmp/a.xlsx", "download"],
    ["/tmp/a.docx", "download"],
    ["/tmp/a.pptx", "download"],
    ["/tmp/a.tar.gz", "download"],
    ["/tmp/a.sqlite", "download"],
  ])
    assert.equal(filePresentation(path).kind, kind, path);
  for (const path of [
    "/tmp/a.ts",
    "/tmp/a.js",
    "/tmp/a.json",
    "/tmp/README",
    "/tmp/mp4",
    "/tmp/.env",
    "/tmp/a.html",
  ])
    assert.equal(filePresentation(path), null, path);
});

test("正文读取保留 UTF-8、空白与有效替换字符，二进制和无效 UTF-8 转为下载", () => {
  for (const text of [
    "",
    "中文与 emoji 😀\n\t正文\r\n",
    "const text = '�';",
    "\ufeff正文",
  ])
    assert.equal(
      decodeTextFile(new TextEncoder().encode(text)),
      text.replace(/^\ufeff/, ""),
    );
  for (const bytes of [
    [0, 1, 2],
    [255, 254, 1, 2],
    [65, 66, 3],
    [0xc3, 0x28],
  ])
    assert.equal(decodeTextFile(Uint8Array.from(bytes)), null);
});
