import assert from "node:assert/strict";
import React, { act } from "react";
import { create } from "react-test-renderer";

export async function testVersionDetails(app, fixture) {
  const { requests } = fixture;
  let versionView;
  await act(async () => {
    versionView = create(React.createElement(app.VersionDetails));
  });
  assert(JSON.stringify(versionView.toJSON()).includes("1.2.3"));
  assert(!JSON.stringify(versionView.toJSON()).includes("dev."));
  await act(async () => {
    app.set({
      serverVersion: {
        version: "1.2.2",
        displayVersion: "1.2.2",
        revision: "def123456789",
        dirty: false,
        channel: "release",
        builtAt: null,
      },
    });
  });
  const versionText = JSON.stringify(versionView.toJSON());
  assert(versionText.includes("1.2.3"));
  for (const marker of [
    "def123456789",
    "未提交",
    "dev.",
    "构建",
    "桥接",
    "1.2.2",
  ])
    assert(!versionText.includes(marker));
  await act(async () => versionView.unmount());
  console.log("PASS 关于页只显示产品版本，连接变化保持版本展示且隐藏开发标记");
}
