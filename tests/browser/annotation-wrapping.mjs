import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

export async function verifyAnnotationWrapping({
  select,
  fill,
  evaluate,
  pause,
  screenshot,
  output,
}) {
  await select("先检查项目实际配置");
  for (const theme of ["light", "dark"]) {
    await evaluate(
      `document.documentElement.dataset.theme=${JSON.stringify(theme)}`,
    );
    for (let length = 1; length <= 100; length++) {
      const text = "i".repeat(length);
      await fill(".annotation-editor textarea", text);
      await pause(20);
      assert.equal(
        await evaluate("!!document.querySelector('.fatal')"),
        false,
        theme + " 输入长度 " + length,
      );
      assert.equal(
        await evaluate(
          "document.querySelector('.annotation-editor textarea').value",
        ),
        text,
      );
    }
    await fill(".annotation-editor textarea", "中文批注".repeat(30));
    await screenshot("wrapping-" + theme);
    await fill(".annotation-editor textarea", "短批注");
    assert.equal(
      await evaluate(
        "document.querySelector('.annotation-editor').dataset.expanded",
      ),
      "false",
    );
  }
  await writeFile(
    join(output, "wrapping-results.json"),
    JSON.stringify(
      { passed: true, themes: ["light", "dark"], lengths: [1, 100] },
      null,
      2,
    ),
  );
  console.log("PASS 批注换行边界连续输入、中文长文和删除后收起");
}
