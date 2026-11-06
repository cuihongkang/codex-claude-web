import { testClaudeLargeFile } from "./dual-backends-large-file.mjs";
import { testClaudeNativeSkill } from "./dual-backends-native-skill.mjs";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
export async function testDualConversation({
  page,
  url,
  mcpReady,
  releaseReply,
  editRequest,
  releaseEdit,
  failureRequest,
  releaseFailure,
  modelServer,
  secondServer,
  completed,
  largeFile,
  largeFileOriginal,
}) {
  await page.goto(url);
  await page.getByLabel("模型", { exact: true }).waitFor();
  const input = () => page.locator(".markdown-composer .ProseMirror");
  await input().waitFor();
  await input().fill("Codex 草稿");
  await page
    .getByLabel("模型", { exact: true })
    .selectOption({ label: "测试供应商 · fixture-model" });

  await input().fill("Claude 草稿");
  await page
    .getByLabel("模型", { exact: true })
    .selectOption({ label: "ChatGPT · GPT Test" });
  await page.waitForFunction(() =>
    document
      .querySelector(".ProseMirror")
      ?.textContent?.includes("Claude 草稿"),
  );
  await page
    .getByLabel("模型", { exact: true })
    .selectOption({ label: "测试供应商 · fixture-model" });
  await page.waitForFunction(() =>
    document
      .querySelector(".ProseMirror")
      ?.textContent?.includes("Claude 草稿"),
  );
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  await page.locator(".working-status").waitFor();
  assert.equal(
    (await page.locator(".working-status").innerText()).includes("Codex"),
    false,
  );
  await page.getByRole("button", { name: "插件与连接", exact: true }).click();
  await page
    .locator(".catalog-card")
    .filter({ hasText: "browser-fixture" })
    .getByText("0 项工具 · 正在连接", { exact: true })
    .waitFor();
  await writeFile(mcpReady, "ready");
  await page
    .locator(".catalog-card")
    .filter({ hasText: "browser-fixture" })
    .getByText("1 项工具 · 已连接", { exact: true })
    .waitFor();
  await page.getByRole("button", { name: "关闭窗口", exact: true }).click();
  releaseReply();
  await page.getByText("双后端验证通过", { exact: true }).first().waitFor();
  await page.waitForFunction(() =>
    /196,608/.test(document.querySelector(".context-info")?.textContent),
  );
  const verifyThinking = async () => {
    const process = page.locator(".process-history").first();
    await process.locator(":scope > summary").click();
    const thinking = process.locator("details.reasoning-summary").first();
    await thinking.locator(":scope > summary").click();
    await thinking.getByText("思考正文末尾标记。", { exact: true }).waitFor();
    assert.ok(
      (await thinking.locator(".activity-body").innerText()).includes(
        "这是原生完整思考正文。".repeat(40),
      ),
    );
    await process.locator(":scope > summary").click();
  };
  await verifyThinking();
  assert.equal(
    modelServer.requests.filter((request) =>
      request.messages.some(
        (message) =>
          message.role === "user" &&
          Array.isArray(message.content) &&
          message.content.some((block) => block.text === "Claude 草稿"),
      ),
    ).length,
    1,
  );
  assert.equal(secondServer.requests.length, 0);
  assert.equal(modelServer.requests[0].thinking.type, "adaptive");
  assert.equal(modelServer.requests[0].output_config?.effort, undefined);
  assert(
    modelServer.requests.every((request) =>
      request.messages.every((message) => message.role !== "system"),
    ),
  );
  const sessionId = await page.evaluate(() =>
    localStorage.getItem("cx-current"),
  );
  await page.waitForFunction(
    () => !document.querySelector('select[aria-label="模型"]').disabled,
  );
  await input().fill("@中文");
  await input().press("End");
  await page
    .getByRole("listbox", { name: "引用建议" })
    .getByRole("option")
    .filter({ hasText: "中文目录" })
    .first()
    .waitFor();
  await page
    .getByRole("listbox", { name: "引用建议" })
    .getByRole("option")
    .filter({ hasText: "中文文件.js" })
    .first()
    .waitFor();
  await input().press("Escape");
  await input().fill("@fztrg");
  await input().press("End");
  await page
    .getByRole("listbox", { name: "引用建议" })
    .getByRole("option")
    .filter({ hasText: "fuzzy-target.mjs" })
    .waitFor();
  await input().press("Escape");
  await testClaudeLargeFile({
    page,
    input,
    path: largeFile,
    original: largeFileOriginal,
  });
  await testClaudeNativeSkill({ page, input, modelServer, completed });
  await page
    .getByLabel("模型", { exact: true })
    .selectOption({ label: "第二供应商 · fixture-model" });
  await input().fill("继续当前对话");
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  await page.getByText("供应商切换成功", { exact: true }).first().waitFor();
  await page.waitForFunction(
    () => !document.querySelector('select[aria-label="模型"]').disabled,
  );
  await input().fill("底部独立草稿");
  await page
    .getByRole("button", { name: "编辑上一条消息", exact: true })
    .click();
  await page.locator(".user-message-editor .ProseMirror").fill("修改当前问题");
  await page
    .locator(".user-message-editor")
    .getByRole("button", { name: "发送", exact: true })
    .click();
  await editRequest;
  await page.locator(".working-status").waitFor();
  releaseEdit();
  await page.locator(".working-status").waitFor({ state: "hidden" });
  await page.getByText("修改当前问题", { exact: true }).first().waitFor();
  await page.waitForFunction(
    () => !document.querySelector('select[aria-label="模型"]').disabled,
  );
  assert.equal(
    await page.getByText("继续当前对话", { exact: true }).count(),
    0,
  );
  assert.equal(await input().innerText(), "底部独立草稿");
  await input().fill("触发API故障");
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  await failureRequest;
  await page.locator(".working-status").waitFor();
  await input().fill("失败期间继续编辑");
  releaseFailure();
  await page
    .locator(".error-banner")
    .getByRole("button", { name: "编辑并重试", exact: true })
    .waitFor();
  assert.equal(
    await page
      .locator(".assistant-message")
      .filter({ hasText: "fixture-api-error" })
      .count(),
    0,
  );
  assert.equal(await input().innerText(), "失败期间继续编辑");
  await page.reload();
  await page
    .locator(".error-banner")
    .getByRole("button", { name: "编辑并重试", exact: true })
    .waitFor();
  await input().waitFor();
  assert.equal(await input().innerText(), "失败期间继续编辑");
  await page
    .locator(".error-banner")
    .getByRole("button", { name: "编辑并重试", exact: true })
    .click();
  await page.locator(".user-message-editor .ProseMirror").fill("故障恢复重试");
  await page
    .locator(".user-message-editor")
    .getByRole("button", { name: "发送", exact: true })
    .click();
  await page.getByText("故障恢复重试", { exact: true }).first().waitFor();
  await completed("故障恢复重试");
  assert.equal(await input().innerText(), "失败期间继续编辑");
  assert.equal(
    await page.evaluate(() => localStorage.getItem("cx-current")),
    sessionId,
  );
  assert.ok(
    secondServer.requests.some((request) =>
      JSON.stringify(request.messages).includes("Claude 草稿"),
    ),
  );
  await page.reload();
  await page.getByText("供应商切换成功", { exact: true }).first().waitFor();
  await page.waitForFunction(
    () =>
      document.querySelector('select[aria-label="模型"]')?.selectedOptions[0]
        ?.textContent === "第二供应商 · fixture-model",
  );
  await page.getByText("双后端验证通过", { exact: true }).first().waitFor();

  await verifyThinking();
  return input;
}
