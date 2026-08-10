import { expect, test } from "@playwright/test";

test("searches a message and returns to its authoritative source", async ({ page }, testInfo) => {
  await page.goto("/conversation");
  await expect(page.locator(".room-header h1")).toBeVisible();

  if (testInfo.project.name === "mobile-chromium") {
    await page.getByRole("button", { name: "打开房间列表" }).click();
  }
  const roomName = `搜索验收室 ${Date.now()} ${testInfo.project.name}`;
  await page.getByRole("button", { name: "新建房间" }).click();
  await page.getByRole("textbox", { name: "房间名称" }).fill(roomName);
  await page.getByRole("button", { name: "创建房间" }).click();
  await expect(page.locator(".room-header h1")).toHaveText(roomName);

  const marker = `SEARCH-${Date.now()}-${testInfo.project.name}`;
  await page.getByLabel(`发送到${roomName}`).fill(`${marker} 权威来源消息`);
  const persisted = page.waitForResponse((response) =>
    response.request().method() === "POST"
    && /\/api\/v1\/rooms\/[^/]+\/messages$/u.test(response.url()));
  await page.getByRole("button", { name: "发送消息" }).click();
  expect((await persisted).ok()).toBe(true);

  await page.getByRole("button", { name: "搜索消息和文件" }).click();
  await page.getByLabel("搜索关键词").fill(marker);
  await page.getByRole("button", { name: "搜索", exact: true }).click();
  const result = page.locator(".conversation-search__result").filter({ hasText: marker });
  await expect(result).toBeVisible();
  await result.click();
  await expect(page.locator(".room-message[data-focused]")).toContainText(marker);
  await expect(page.locator("aside.conversation-search")).toHaveCount(0);

  expect(await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  )).toBe(false);
});
