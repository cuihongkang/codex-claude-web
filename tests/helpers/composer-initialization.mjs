import assert from "node:assert/strict";

export async function holdDocumentEditor(page) {
  let release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  await page.route("**/document-editor.js", async (route) => {
    await pending;
    await route.continue();
  });
  return release;
}

export async function checkComposerInitialization(page, release) {
  const fallback = page.locator(".markdown-composer > textarea");
  await fallback.fill("短对话加载期间的草稿");
  await page.getByRole("button", { name: /^超长对话性能验证/ }).click();
  await fallback.fill("长对话加载期间的草稿");
  await page.getByRole("button", { name: /^简短对话/ }).click();
  assert.equal(await fallback.inputValue(), "短对话加载期间的草稿");
  const text = "加载期间选择这两个字继续";
  await fallback.fill(text);
  await fallback.evaluate((element) => {
    const start = element.value.indexOf("两个字");
    element.setSelectionRange(start, start + 3);
  });
  const height = (await fallback.boundingBox()).height;
  release();
  await page.locator(".markdown-composer .ProseMirror").waitFor();
  await page.waitForFunction(() => getSelection().toString() === "两个字");
  const viewport = page.locator(".document-editor-viewport");
  assert(
    Math.abs((await viewport.boundingBox()).height - height) < 1,
    "初始化前后编辑区保持尺寸一致",
  );
  assert.equal(
    await page.locator(".document-editor-viewport .milkdown").count(),
    1,
  );
  await page.keyboard.insertText("替换");
  await page.waitForFunction(
    () => localStorage.getItem("cx-draft-short") === "加载期间选择这替换继续",
  );
  assert.equal(
    await page.evaluate(() => localStorage.getItem("cx-draft-long")),
    "长对话加载期间的草稿",
  );
}
