import { expect, test } from "@playwright/test";

test("replies, edits, and retracts an owned message", async ({ page }, testInfo) => {
  await page.goto("/conversation");
  await expect(page.locator(".room-header h1")).toBeVisible();

  if (testInfo.project.name === "mobile-chromium") {
    await page.getByRole("button", { name: "打开房间列表" }).click();
  }
  const roomName = `消息操作验收室 ${Date.now()} ${testInfo.project.name}`;
  await page.getByRole("button", { name: "新建房间" }).click();
  await page.getByRole("textbox", { name: "房间名称" }).fill(roomName);
  await page.getByRole("button", { name: "创建房间" }).click();
  await expect(page.locator(".room-header h1")).toHaveText(roomName);

  for (const selected of await page.locator(".room-composer__agent[aria-pressed='true']").all()) {
    await selected.click();
  }
  const original = `原始消息 ${Date.now()} ${testInfo.project.name}`;
  await page.getByLabel(`发送到${roomName}`).fill(original);
  const originalPersisted = page.waitForResponse((response) =>
    response.request().method() === "POST"
    && /\/api\/v1\/rooms\/[^/]+\/messages$/u.test(response.url()));
  await page.getByRole("button", { name: "发送消息" }).click();
  const originalBody = await (await originalPersisted).json() as {
    message: { id: string };
  };
  const firstMessage = page.locator(`#message-${originalBody.message.id}`);
  await expect(firstMessage).toBeVisible();

  await firstMessage.getByRole("button", { name: "消息操作" }).click();
  await firstMessage.getByRole("menuitem", { name: "回复" }).click();
  await expect(page.getByText("回复 你")).toBeVisible();
  await page.getByLabel(`发送到${roomName}`).fill("这是带引用的第二条消息");
  await page.getByRole("button", { name: "发送消息" }).click();
  const reply = page.locator(".room-message").filter({ hasText: "这是带引用的第二条消息" });
  await expect(reply.locator(".room-message__quote")).toContainText(original);

  await firstMessage.getByRole("button", { name: "消息操作" }).click();
  await firstMessage.getByRole("menuitem", { name: "编辑" }).click();
  const updated = `更新后的消息 ${Date.now()}`;
  await firstMessage.getByRole("textbox", { name: "编辑消息" }).fill(updated);
  const edited = page.waitForResponse((response) =>
    response.request().method() === "PATCH"
    && /\/api\/v1\/rooms\/[^/]+\/messages\/[^/]+$/u.test(response.url()));
  await firstMessage.getByRole("button", { name: "保存" }).click();
  expect((await edited).ok()).toBe(true);
  await expect(firstMessage).toContainText(updated);
  await expect(reply.locator(".room-message__quote")).toContainText(updated);

  await firstMessage.getByRole("button", { name: "消息操作" }).click();
  await firstMessage.getByRole("menuitem", { name: "撤回" }).click();
  await expect(firstMessage.getByRole("alertdialog", { name: "确认撤回消息" })).toBeVisible();
  const retracted = page.waitForResponse((response) =>
    response.request().method() === "DELETE"
    && /\/api\/v1\/rooms\/[^/]+\/messages\/[^/]+$/u.test(response.url()));
  await firstMessage.getByRole("button", { name: "确认撤回" }).click();
  expect((await retracted).ok()).toBe(true);
  await expect(firstMessage).toContainText("这条消息已撤回");
  await expect(reply.locator(".room-message__quote")).toContainText("消息已撤回");

  expect(await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  )).toBe(false);
});
