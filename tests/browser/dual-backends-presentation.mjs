import assert from "node:assert/strict";
import { join } from "node:path";
export async function testDualPresentation({
  page,
  input,
  artifacts,
  modelServer,
  secondServer,
  completed,
  errors,
}) {
  const modelOptions = await page
    .getByLabel("模型", { exact: true })
    .locator("option")
    .allTextContents();
  assert.ok(modelOptions.some((name) => name.includes("第二供应商")));
  assert.equal(
    modelOptions.some((name) => /^Claude(?: Code)? ·/.test(name)),
    false,
  );
  await page.waitForFunction(
    () =>
      document.querySelector(".account-button b")?.textContent === "第二供应商",
  );
  assert.equal(await page.locator(".quota-toggle").count(), 0);
  await page.screenshot({
    path: join(artifacts, "configured-provider-no-subscription.png"),
    animations: "disabled",
  });
  const collapsedProjects = page.locator(
    '.project-heading > button[aria-expanded="false"]',
  );
  while (await collapsedProjects.count())
    await collapsedProjects.first().click();
  const claudeRow = page
    .locator(".thread-link")
    .filter({ has: page.locator('[data-backend="claude"]') })
    .first();
  const codexRow = page
    .locator(".thread-link")
    .filter({ has: page.locator('[data-backend="codex"]') })
    .first();
  await claudeRow.waitFor();
  await codexRow.waitFor();
  for (const backend of ["claude", "codex"]) {
    await (backend === "claude" ? claudeRow : codexRow).click();
    await page.waitForFunction(
      (backend) =>
        document.querySelector(".topbar > .backend-badge")?.dataset.backend ===
        backend,
      backend,
    );
    await page.getByRole("button", { name: "插件与连接", exact: true }).click();
    await page
      .locator(".catalog-card")
      .filter({
        hasText: backend === "claude" ? "browser-fixture" : "codex-only-server",
      })
      .waitFor();
    assert.equal(
      await page
        .locator(".catalog-card")
        .filter({
          hasText:
            backend === "claude" ? "codex-only-server" : "browser-fixture",
        })
        .count(),
      0,
    );
    await page.getByRole("button", { name: "关闭窗口", exact: true }).click();
    for (const theme of ["light", "dark"]) {
      await page.evaluate((theme) => {
        document.documentElement.dataset.theme = theme;
      }, theme);
      for (const scale of [0.8, 1, 1.25, 1.5, 2]) {
        await page.evaluate((scale) => {
          document.documentElement.style.zoom = scale;
        }, scale);
        const badge = page.locator(".topbar > .backend-badge");
        assert.equal(await badge.innerText(), "");
        assert.equal(await badge.getAttribute("aria-hidden"), "true");
        assert.equal(await badge.getAttribute("title"), null);
        const box = await badge.boundingBox();
        assert.ok(box.width > 10 && box.x >= 0 && box.x + box.width <= 1280);
      }
      await page.evaluate(() => {
        document.documentElement.style.zoom = 1;
      });
      await page.mouse.move(1200, 800);
      await page.screenshot({
        path: join(artifacts, backend + "-conversation-" + theme + ".png"),
        animations: "disabled",
        fullPage: true,
      });
    }
  }
  await claudeRow.click();
  await page.getByText("供应商切换成功", { exact: true }).first().waitFor();
  await page.setViewportSize({ width: 390, height: 900 });
  for (const theme of ["light", "dark"]) {
    await page.evaluate((theme) => {
      document.documentElement.dataset.theme = theme;
    }, theme);
    for (const scale of [0.8, 1, 1.25, 1.5, 2]) {
      await page.evaluate((scale) => {
        document.documentElement.style.zoom = scale;
      }, scale);
      const box = await page.locator(".topbar > .backend-badge").boundingBox();
      assert.ok(box.width > 10 && box.x >= 0 && box.x + box.width <= 390);
      assert.equal(await input().isVisible(), true);
    }
    await page.evaluate(() => {
      document.documentElement.style.zoom = 1;
    });
    await page.screenshot({
      path: join(artifacts, `claude-conversation-mobile-${theme}.png`),
      animations: "disabled",
      fullPage: true,
    });
  }
  await page.getByRole("button", { name: "显示侧栏", exact: true }).click();
  await page.screenshot({
    path: join(artifacts, "backend-sidebar-mobile.png"),
    animations: "disabled",
    fullPage: true,
  });
  await page.getByRole("button", { name: "收起侧栏", exact: true }).click();
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole("button", { name: "显示侧栏", exact: true }).click();
  await page
    .getByRole("button", { name: "在当前目录新建对话", exact: true })
    .click();
  await page
    .getByLabel("模型", { exact: true })
    .selectOption({ label: "ChatGPT · GPT Test" });
  await page.waitForFunction(
    () =>
      document.querySelector('select[aria-label="模型"]')?.selectedOptions[0]
        ?.textContent === "ChatGPT · GPT Test",
  );
  await input().fill("CtrlEnter立即发送");
  await page
    .getByLabel("模型", { exact: true })
    .selectOption({ label: "测试供应商 · fixture-model" });
  await input().press("Control+Enter");
  await completed("CtrlEnter立即发送");
  const keyboardRequests = (server) =>
    server.requests.filter((request) =>
      request.messages.some(
        (message) =>
          message.role === "user" &&
          Array.isArray(message.content) &&
          message.content.some((block) => block.text === "CtrlEnter立即发送"),
      ),
    );
  assert.equal(keyboardRequests(modelServer).length, 1);
  assert.equal(keyboardRequests(secondServer).length, 0);
  assert.equal(
    await page
      .getByLabel("模型", { exact: true })
      .locator("option")
      .filter({ hasText: /^Claude(?: Code)? ·/ })
      .count(),
    0,
  );
  await input().fill("/usage");
  await input().press("End");
  await page
    .getByRole("listbox", { name: "快捷命令" })
    .getByRole("option")
    .filter({ hasText: "/usage" })
    .waitFor();
  await input().press("Escape");
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  await completed("/usage");
  for (const server of [modelServer, secondServer])
    assert.equal(
      server.requests.filter((request) =>
        request.messages.some(
          (message) =>
            message.role === "user" &&
            Array.isArray(message.content) &&
            message.content.some((block) => block.text === "/usage"),
        ),
      ).length,
      0,
    );
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByText("模型与服务配置", { exact: true }).click();
  assert.equal(
    await page.getByRole("button", { name: "添加后端", exact: true }).count(),
    0,
  );
  assert.equal(await page.locator(".backend-card").count(), 2);
  const codexCard = page
    .locator(".backend-card")
    .filter({ has: page.locator("strong", { hasText: /^Codex$/ }) });
  assert.equal(
    await codexCard.getByText("供应商与模型", { exact: true }).count(),
    0,
  );
  await page.getByText("供应商与模型", { exact: true }).click();
  await page.getByRole("button", { name: "添加供应商", exact: true }).click();
  await page.getByLabel("名称", { exact: true }).fill("第三供应商");
  await page.getByLabel("API 地址", { exact: true }).fill(modelServer.url);
  await page
    .getByLabel("模型标识（每行一个）", { exact: true })
    .fill("fixture-model");
  await page.getByRole("button", { name: "保存供应商", exact: true }).click();
  await page
    .locator(".backend-settings")
    .getByText("第三供应商", { exact: true })
    .waitFor();
  assert.equal(await page.locator(".backend-card").count(), 2);
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const theme of ["light", "dark"]) {
      await page.evaluate((theme) => {
        document.documentElement.dataset.theme = theme;
      }, theme);
      for (const scale of [0.8, 1, 1.25, 1.5, 2]) {
        await page.evaluate((scale) => {
          document.documentElement.style.zoom = scale;
        }, scale);
        assert.equal(await page.locator(".backend-settings").isVisible(), true);
      }
      await page.evaluate(() => {
        document.documentElement.style.zoom = 1;
      });
      await page.waitForFunction(() => {
        const button = document.querySelector(
          ".backend-settings button:not(:disabled)",
        );
        return (
          button &&
          getComputedStyle(button).color ===
            getComputedStyle(document.documentElement).color
        );
      });
      await page.screenshot({
        animations: "disabled",
        path: join(artifacts, `${width}-${theme}.png`),
        fullPage: true,
      });
    }
  }
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      drafts: true,
      send: true,
      reload: true,
      backendSettings: true,
      sameSessionProviderSwitch: true,
      immediateButtonSelection: true,
      immediateCtrlEnterSelection: true,
      fuzzyFilesAndDirectories: true,
      nativeLargeFileEditing: true,
      nativeSkillExpansion: true,
      historyEditing: true,
      apiFailureRecovery: true,
      failureDraftPreserved: true,
      mcpPendingAndConnected: true,
      pluginCurrentTargetIsolation: true,
      nativeUsageCommand: true,
      unauthenticatedNativeModelsHidden: true,
      configuredProviderIdentity: true,
      activeContextCapacity: true,
      activeTimerRefreshAndCompletion: true,
      identicalModelNames: true,
      viewports: [1280, 390],
      scales: [0.8, 1, 1.25, 1.5, 2],
      pageErrors: errors,
    }),
  );
}
