import assert from "node:assert/strict";
import { join } from "node:path";

export async function testContextTimer({
  page,
  input,
  timerRequest,
  releaseTimer,
  completed,
  artifacts,
}) {
  await input().fill("上下文计时验证");
  await input().press("Control+Enter");
  await timerRequest;
  const elapsed = () => page.locator(".process-duration").last();
  await elapsed().filter({ hasText: "已用时" }).waitFor();
  await page.waitForFunction(() =>
    /65,536/.test(document.querySelector(".context-info")?.textContent),
  );
  const start = await elapsed().getAttribute("datetime");
  await page.waitForFunction((start) => {
    const value = [...document.querySelectorAll(".process-duration")]
      .at(-1)
      ?.getAttribute("datetime");
    return (
      Number(value?.match(/\d+/)?.[0]) >= Number(start.match(/\d+/)[0]) + 2
    );
  }, start);
  await page.reload();
  await input().waitFor();
  await elapsed().filter({ hasText: "已用时" }).waitFor();
  const restored = await elapsed().getAttribute("datetime");
  assert.ok(
    Number(restored.match(/\d+/)[0]) >= Number(start.match(/\d+/)[0]) + 2,
  );
  await page.waitForFunction(
    (restored) =>
      [...document.querySelectorAll(".process-duration")]
        .at(-1)
        ?.getAttribute("datetime") !== restored,
    restored,
  );
  await page.screenshot({
    path: join(artifacts, "active-timer-context-window.png"),
    animations: "disabled",
  });
  releaseTimer();
  await completed("上下文计时验证");
  await elapsed().filter({ hasText: "总耗时" }).waitFor();
  const finished = await elapsed().getAttribute("datetime");
  await page.waitForTimeout(2100);
  assert.equal(await elapsed().getAttribute("datetime"), finished);
  await page.screenshot({
    path: join(artifacts, "completed-timer-context-window.png"),
    animations: "disabled",
  });
}
