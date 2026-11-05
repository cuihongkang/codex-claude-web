import assert from "node:assert/strict";
import { join } from "node:path";

export async function checkComposerEditing(page, output, capture = false) {
  const field = page.locator(".markdown-composer .ProseMirror");
  const results = [];
  async function clear() {
    await page
      .locator(".document-editor-viewport")
      .click({ position: { x: 20, y: 15 } });
    await page.keyboard.press("Control+A");
    await page.keyboard.press("Backspace");
  }
  for (const list of [false, true]) {
    await clear();
    await page.keyboard.type(list ? "- " : "");
    await page.keyboard.insertText("第一行是的");
    await page.keyboard.press("Enter");
    await page.keyboard.insertText("第二行是的");
    const two = await geometry(field);
    assert.equal(two.paragraphs.length >= 2, true);
    for (const line of two.paragraphs.slice(0, 2)) {
      assert(
        line.top >= two.top - 1 && line.bottom <= two.bottom + 1,
        `两行文字应完整显示：${JSON.stringify(two)}`,
      );
      assert(
        Math.abs(line.height - two.lineHeight) < 1,
        "普通文本和列表共用正文行高",
      );
    }
    assert.equal(two.virtualCursors, 0, "编辑区使用浏览器原生光标");
    assert.equal(two.caretColor, two.color);
    if (capture)
      await page.locator(".composer").screenshot({
        path: join(output, list ? "two-lines-list.png" : "two-lines-text.png"),
        caret: "initial",
      });
    await field
      .locator("p")
      .nth(1)
      .click({ position: { x: 5, y: 8 } });
    await page.keyboard.press("End");
    await page.keyboard.insertText("定位");
    assert(
      (await field.locator("p").nth(1).textContent()).endsWith("是的定位"),
    );
    await page.waitForTimeout(600);
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.insertText("中间");
    assert(
      (await field.locator("p").nth(1).textContent()).endsWith("是的定中间位"),
    );
    await page.keyboard.press("Control+z");
    assert(
      (await field.locator("p").nth(1).textContent()).endsWith("是的定位"),
    );
    await page.keyboard.press("Control+y");
    assert(
      (await field.locator("p").nth(1).textContent()).endsWith("是的定中间位"),
    );
    await page.waitForTimeout(30);
    for (let index = 3; index <= 12; index++) {
      await page.keyboard.press("End");
      await page.waitForTimeout(30);
      await page.keyboard.press("Enter");
      await page.keyboard.insertText(`第${index}行内容`);
    }
    const long = await geometry(field);
    assert(
      long.caret &&
        long.caret.top >= long.top - 1 &&
        long.caret.bottom <= long.bottom + 1,
      `连续键入的光标应在可视编辑区：${JSON.stringify(long)}`,
    );
    const viewport = page.locator(".document-editor-viewport");
    await viewport.evaluate((element) => {
      element.scrollTop = 0;
    });
    await page.keyboard.press("End");
    await page.keyboard.insertText("滚动后继续");
    const resumed = await geometry(field);
    assert(
      resumed.caret.top >= resumed.top - 1 &&
        resumed.caret.bottom <= resumed.bottom + 1,
      "滚动后键入应回到真实光标位置",
    );
    const last = resumed.paragraphs.flatMap((p) => p.lines).slice(-2);
    for (const line of last)
      assert(
        line.top >= resumed.top - 1 && line.bottom <= resumed.bottom + 1,
        `末尾两行应完整显示：${JSON.stringify(resumed)}`,
      );
    if (capture)
      await page.locator(".composer").screenshot({
        path: join(output, list ? "editing-list.png" : "editing-text.png"),
        caret: "initial",
      });
    results.push({ list, two, long, resumed });
  }
  await clear();
  return results;
}

async function geometry(field) {
  return field.evaluate((element) => {
    const viewport = element.closest(".document-editor-viewport") || element;
    const bounds = viewport.getBoundingClientRect();
    const scale = bounds.height / parseFloat(getComputedStyle(viewport).height);
    const style = getComputedStyle(element);
    const range = getSelection().rangeCount
      ? getSelection().getRangeAt(0).cloneRange()
      : null;
    range?.collapse(false);
    const caret = range?.getClientRects()[0];
    return {
      top: bounds.top,
      bottom: bounds.bottom,
      lineHeight: parseFloat(style.lineHeight) * scale,
      color: style.color,
      caretColor: style.caretColor,
      scrollTop: viewport.scrollTop,
      virtualCursors: element.querySelectorAll(".prosemirror-virtual-cursor")
        .length,
      caret: caret
        ? { top: caret.top, bottom: caret.bottom, left: caret.left }
        : null,
      paragraphs: [...element.querySelectorAll("p")].map((p) => {
        const rect = p.getBoundingClientRect();
        const textRange = document.createRange();
        textRange.selectNodeContents(p);
        return {
          text: p.textContent,
          top: rect.top,
          bottom: rect.bottom,
          height: rect.height,
          lines: p.textContent
            ? [...textRange.getClientRects()].map((rect) => ({
                top: rect.top,
                bottom: rect.bottom,
              }))
            : [],
        };
      }),
    };
  });
}
