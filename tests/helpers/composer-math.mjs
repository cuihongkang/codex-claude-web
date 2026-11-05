import assert from "node:assert/strict";
import { join } from "node:path";

export async function checkComposerMath(page, output) {
  const field = page.locator(".markdown-composer .ProseMirror");
  await field.focus();
  await page.keyboard.press("Control+A");
  await page.keyboard.press("Backspace");
  const bounds = await page.locator(".composer").boundingBox();
  for (const multiline of [false, true]) {
    await page.keyboard.insertText("前文 ");
    await page.keyboard.type("$$");
    if (multiline) await page.keyboard.press("Enter");
    await page.keyboard.type("x_{t+1}=x_t+dx");
    assert.equal(
      await field.locator(".katex").count(),
      0,
      "公式闭合前保留源码",
    );
    if (multiline) await page.keyboard.press("Enter");
    await page.keyboard.type("$");
    assert.equal(
      await field.locator(".katex").count(),
      0,
      "一个结束美元符号保持编辑",
    );
    await page.keyboard.type("$");
    await field.locator(".document-math-inline .katex").waitFor();
    assert.equal(
      await field.locator(".milkdown-code-block, .preview-panel").count(),
      0,
    );
    const draft = await page.evaluate(() =>
      localStorage.getItem("cx-draft-short"),
    );
    assert.equal(draft.trim(), "前文 $$x_{t+1}=x_t+dx$$");
    const after = await page.locator(".composer").boundingBox();
    assert(Math.abs(after.height - bounds.height) < 1);
    await page.locator(".composer").screenshot({
      path: join(
        output,
        multiline ? "math-multiline.png" : "math-same-line.png",
      ),
    });
    await page.keyboard.press("Control+z");
    assert.equal(await field.locator(".katex").count(), 0);
    assert((await field.textContent()).startsWith("前文 $"));
    await page.keyboard.press("Control+y");
    await field.locator(".document-math-inline .katex").waitFor();
    await page.keyboard.insertText("继续正文");
    assert.equal(await field.locator("p").count(), 1);
    assert((await field.locator("p").textContent()).endsWith("继续正文"));
    assert.equal(await field.locator(".katex-display").count(), 0);
    await page.locator(".composer").screenshot({
      path: join(output, "math-inline-continuation.png"),
    });
    await field.locator(".document-math-inline").dblclick();
    assert.equal(await field.locator(".katex").count(), 0);
    await page.keyboard.type("$$");
    await field.locator(".document-math-inline .katex").waitFor();
    const edited = await page.evaluate(() =>
      localStorage.getItem("cx-draft-short"),
    );
    assert(edited.includes("继续正文") && !edited.includes("<br />"));
    await page.reload();
    await field.waitFor();
    await field.locator(".document-math-inline .katex").waitFor();
    assert.equal(await field.locator("p").count(), 1);
    assert.equal(await field.locator(".katex-display").count(), 0);
    assert((await field.locator("p").textContent()).endsWith("继续正文"));
    await field.focus();
    await page.keyboard.press("Control+A");
    await page.keyboard.press("Backspace");
  }
}
