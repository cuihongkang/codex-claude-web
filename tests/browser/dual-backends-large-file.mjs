import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

export async function testClaudeLargeFile({ page, input, path, original }) {
  const requests = [];
  const listener = (request) => {
    const url = new URL(request.url());
    if (url.pathname === "/api/files" && url.searchParams.get("path") === path)
      requests.push(request.method());
  };
  page.on("request", listener);
  try {
    await input().fill("/files");
    await input().press("Control+Enter");
    await page
      .locator(".tree-row")
      .filter({ hasText: "large-native-file.txt" })
      .click();
    const editor = page.locator(".cm-content");
    await editor.waitFor();
    assert.deepEqual(requests, ["HEAD", "GET"]);
    await editor.click();
    await page.keyboard.press("Control+End");
    await page.keyboard.insertText("saved-after-native-cap");
    await page.getByRole("button", { name: "保存文件", exact: true }).click();
    await page.getByText("文件已保存", { exact: true }).waitFor();
    assert.equal(
      await readFile(path, "utf8"),
      original + "saved-after-native-cap",
    );
    await page
      .getByRole("button", { name: "收起对话详情", exact: true })
      .click();
  } finally {
    page.off("request", listener);
  }
}
