import assert from "node:assert/strict";

export async function checkComposerSize(page) {
  const field = page.locator(".markdown-composer .ProseMirror");
  await page
    .locator(".document-editor-viewport")
    .click({ position: { x: 20, y: 15 } });
  await page.keyboard.press("Control+A");
  await page.keyboard.press("Backspace");
  const viewport = page.locator(".document-editor-viewport");
  const before = await dimensions(viewport);
  for (let index = 0; index < 12; index++) {
    if (index) await page.keyboard.press("Enter");
    await page.keyboard.insertText(
      `第 ${index + 1} 行：输入内容在固定区域内滚动。`,
    );
  }
  const after = await dimensions(viewport);
  for (const name of ["height", "composerHeight", "composerTop"])
    assert(
      Math.abs(before[name] - after[name]) < 1,
      `${name} 应保持固定：${before[name]} → ${after[name]}`,
    );
  assert(after.scrollHeight > after.clientHeight, "多行输入应产生内部滚动范围");
  const position = await viewport.boundingBox();
  await page.mouse.move(
    position.x + position.width / 2,
    position.y + position.height / 2,
  );
  await viewport.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  const bottom = await viewport.evaluate((element) => element.scrollTop);
  await page.mouse.wheel(0, -2000);
  await page.waitForFunction(
    (bottom) =>
      document.querySelector(".document-editor-viewport").scrollTop < bottom,
    bottom,
  );
  await page.mouse.wheel(0, 2000);
  await page.waitForFunction(
    () => document.querySelector(".document-editor-viewport").scrollTop > 0,
  );
  return { before, after };
}

function dimensions(field) {
  return field.evaluate((element) => {
    const composer = element.closest(".composer").getBoundingClientRect();
    return {
      height: element.getBoundingClientRect().height,
      composerHeight: composer.height,
      composerTop: composer.top,
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
    };
  });
}
