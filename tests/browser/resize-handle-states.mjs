import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export async function verifyResizeHandleStates({
  page,
  handle,
  output,
  name,
  before = false,
}) {
  await mkdir(output, { recursive: true });
  const records = [];
  const inspect = async (state) => {
    const metrics = await handle.evaluate((node) => {
      const css = getComputedStyle(node);
      const marker = getComputedStyle(node, "::after");
      return {
        shared: node.classList.contains("resize-handle"),
        outline: css.outlineStyle,
        background: css.backgroundColor,
        width: parseFloat(marker.width),
        height: parseFloat(marker.height),
        opacity: Number(marker.opacity),
        focus: node.matches(":focus-visible"),
        dragging: node.dataset.resizing === "true",
      };
    });
    records.push({ state, ...metrics });
    if (!before) {
      assert(metrics.shared, name);
      assert.equal(metrics.outline, "none", name);
      assert.equal(metrics.background, "rgba(0, 0, 0, 0)", name);
      assert(Math.max(metrics.width, metrics.height) <= 50, name);
      assert.equal(
        metrics.opacity,
        { idle: 0.3, hover: 0.65, focus: 0.65, drag: 1 }[state],
        name + state,
      );
      assert.equal(metrics.dragging, state === "drag", name + state);
      if (state === "focus") assert(metrics.focus, name);
    }
    await page.screenshot({ path: join(output, `${name}-${state}.png`) });
  };
  await page.mouse.move(1, 1);
  await handle.evaluate((node) => node.blur());
  await inspect("idle");
  await handle.hover();
  await inspect("hover");
  await page.mouse.move(1, 1);
  await handle.focus();
  await page.keyboard.press("Tab");
  await handle.focus();
  await inspect("focus");
  await handle.evaluate((node) => node.blur());
  await handle.hover();
  await page.mouse.down();
  try {
    await inspect("drag");
  } finally {
    await page.mouse.up();
  }
  if (!before) assert.equal(await handle.getAttribute("data-resizing"), null);
  await handle.evaluate((node) => node.blur());
  await page.mouse.move(1, 1);
  await writeFile(
    join(output, `${name}.json`),
    JSON.stringify({ before, records }, null, 2),
  );
}
