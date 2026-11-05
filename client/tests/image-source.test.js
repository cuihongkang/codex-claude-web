import test from "node:test";
import assert from "node:assert/strict";
import {
  imageDataUrl,
  localImagePath,
  messageUrlTransform,
} from "../src/domain/image-source.js";

test("本地图片识别绝对路径、文件 URI、沙箱引用和相对工作目录", () => {
  assert.equal(localImagePath("/tmp/preview.jpg"), "/tmp/preview.jpg");
  assert.equal(
    localImagePath("file:///tmp/preview%20one.png"),
    "/tmp/preview one.png",
  );
  assert.equal(
    localImagePath("file://localhost/tmp/test.svg"),
    "/tmp/test.svg",
  );
  assert.equal(
    localImagePath("sandbox:/mnt/data/chart.png"),
    "/mnt/data/chart.png",
  );
  assert.equal(
    localImagePath("./images/chart.png", "/project"),
    "/project/images/chart.png",
  );
  assert.equal(
    localImagePath("../chart.png", "/project/nested"),
    "/project/chart.png",
  );
  assert.equal(
    localImagePath("/tmp/%E5%9B%BE%20%2520.png#preview"),
    "/tmp/图 %20.png",
  );
  assert.equal(localImagePath("/tmp/100%.png"), "/tmp/100%.png");
  for (const source of [
    "https://example.com/chart.png",
    "//example.com/chart.png",
    "data:image/png;base64,AQ==",
    "file://remote/tmp/chart.png",
    "chart.png",
    "#preview",
    "",
  ])
    assert.equal(localImagePath(source), null, source);
});

test("图片 MIME 类型覆盖 JPEG 与 SVG，保留原始文件数据", () => {
  assert.equal(
    imageDataUrl("/tmp/photo.JPG", "AQ=="),
    "data:image/jpeg;base64,AQ==",
  );
  assert.equal(
    imageDataUrl("/tmp/chart.svg", "Ag=="),
    "data:image/svg+xml;base64,Ag==",
  );
});

test("Markdown 为本地文件链接和图片放行本地 URI，数据 URL 仅允许指定图片类型", () => {
  const image = { tagName: "img" };
  const link = { tagName: "a" };
  for (const value of [
    "file:///tmp/chart.png",
    "sandbox:/mnt/data/chart.png",
    "data:image/png;base64,AQ==",
    "/tmp/chart.png",
    "https://example.com/chart.png",
    "//example.com/chart.png",
  ])
    assert.equal(messageUrlTransform(value, "src", image), value);
  for (const value of [
    "javascript:alert(1)",
    "data:text/html;base64,AQ==",
    "file://remote/tmp/chart.png",
  ])
    assert.equal(messageUrlTransform(value, "src", image), "");
  for (const value of ["file:///tmp/chart.png", "sandbox:/mnt/data/report.pdf"])
    assert.equal(messageUrlTransform(value, "href", link), value);
  for (const value of [
    "file://remote/tmp/chart.png",
    "javascript:alert(1)",
    "data:text/html;base64,AQ==",
  ])
    assert.equal(messageUrlTransform(value, "href", link), "");
  assert.equal(
    messageUrlTransform("https://example.com", "href", link),
    "https://example.com",
  );
});
