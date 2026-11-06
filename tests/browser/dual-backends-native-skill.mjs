import assert from "node:assert/strict";

export async function testClaudeNativeSkill({
  page,
  input,
  modelServer,
  completed,
}) {
  await input().fill("/native-browser-fixture");
  await input().press("End");
  const option = page
    .getByRole("listbox", { name: "快捷命令" })
    .getByRole("option")
    .filter({ hasText: "native-browser-fixture" });
  await option.waitFor();
  await option.click();
  assert.equal(
    (await input().innerText()).trimEnd(),
    "/native-browser-fixture",
  );
  await input().fill("/native-browser-fixture native-skill-browser-argument");
  const offset = modelServer.requests.length;
  await input().press("Control+Enter");
  await completed("/native-browser-fixture native-skill-browser-argument");
  await page.getByText("双后端验证通过", { exact: true }).last().waitFor();
  const dispatched = modelServer.requests
    .slice(offset)
    .find((request) =>
      JSON.stringify(request.messages).includes(
        "native-skill-browser-argument",
      ),
    );
  assert.ok(dispatched);
  assert.match(
    JSON.stringify(dispatched.messages),
    /native-browser-fixture-body/,
  );
}
