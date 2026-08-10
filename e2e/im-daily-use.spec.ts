import { expect, test } from "@playwright/test";

test("restores drafts and reuses one Agent direct room", async ({ page }, testInfo) => {
  await page.goto("/conversation");
  await expect(page.locator(".room-header h1")).toBeVisible();

  if (testInfo.project.name === "mobile-chromium") {
    await page.getByRole("button", { name: "打开房间列表" }).click();
  }
  await page.getByRole("button", { name: "与Planner单聊" }).click();
  await expect(page.locator(".room-header h1")).toHaveText("Local Planner");
  const directRoomUrl = page.url();

  const composer = page.getByLabel("发送到Local Planner");
  const draft = `跨刷新草稿 ${Date.now()} ${testInfo.project.name}`;
  const saved = page.waitForResponse((response) =>
    response.request().method() === "PUT"
    && /\/api\/v1\/rooms\/[^/]+\/draft$/u.test(response.url()));
  await composer.fill(draft);
  expect((await saved).ok()).toBe(true);
  await page.reload();
  await expect(page.getByLabel("发送到Local Planner")).toHaveValue(draft);

  const persisted = page.waitForResponse((response) =>
    response.request().method() === "POST"
    && /\/api\/v1\/rooms\/[^/]+\/messages$/u.test(response.url()));
  await page.getByRole("button", { name: "发送消息" }).click();
  expect((await persisted).ok()).toBe(true);
  await expect(page.getByLabel("发送到Local Planner")).toHaveValue("");
  await expect(page.locator(".room-message").filter({ hasText: draft })).toBeVisible();

  if (testInfo.project.name === "mobile-chromium") {
    await page.getByRole("button", { name: "打开房间列表" }).click();
  }
  await page.getByRole("button", { name: /切换到.+/ }).first().click();
  await expect(page.locator(".room-header h1")).not.toHaveText("Local Planner");
  if (testInfo.project.name === "mobile-chromium") {
    await page.getByRole("button", { name: "打开房间列表" }).click();
  }
  await page.getByRole("button", { name: "与Planner单聊" }).click();
  await expect(page).toHaveURL(directRoomUrl);
  await expect(page.locator(".room-message").filter({ hasText: draft })).toBeVisible();

  expect(await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  )).toBe(false);
});
