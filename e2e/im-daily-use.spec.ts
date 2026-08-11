import { expect, test } from "@playwright/test";

test("restores drafts and reuses one Agent direct room", async ({ page }, testInfo) => {
  await page.goto("/conversation");
  await expect(page.locator(".room-header h1")).toBeVisible();

  const workspaceResponse = await page.request.get("/api/v1/workspaces/current");
  expect(workspaceResponse.ok()).toBe(true);
  const workspace = await workspaceResponse.json() as {
    agents: Array<{ principalId: string; displayName: string }>;
  };
  const planner = workspace.agents.find((agent) => agent.displayName.includes("Planner"));
  expect(planner).toBeDefined();
  const directResponse = await page.request.post("/api/v1/direct-rooms", {
    data: { agentPrincipalId: planner!.principalId },
  });
  expect(directResponse.ok()).toBe(true);
  const direct = await directResponse.json() as { room: { id: string; name: string } };
  await page.reload();

  if (testInfo.project.name === "mobile-chromium") {
    await page.getByRole("button", { name: "打开房间列表" }).click();
  }
  await page.getByRole("button", { name: `切换到${direct.room.name}` }).click();
  await expect(page.locator(".room-header h1")).toHaveText(direct.room.name);
  const directRoomUrl = page.url();

  const composer = page.getByLabel(`发送到${direct.room.name}`);
  const draft = `跨刷新草稿 ${Date.now()} ${testInfo.project.name}`;
  const saved = page.waitForResponse((response) =>
    response.request().method() === "PUT"
    && /\/api\/v1\/rooms\/[^/]+\/draft$/u.test(response.url()));
  await composer.fill(draft);
  expect((await saved).ok()).toBe(true);
  await page.reload();
  await expect(page.getByLabel(`发送到${direct.room.name}`)).toHaveValue(draft);

  const persisted = page.waitForResponse((response) =>
    response.request().method() === "POST"
    && /\/api\/v1\/rooms\/[^/]+\/messages$/u.test(response.url()));
  await page.getByRole("button", { name: "发送消息" }).click();
  expect((await persisted).ok()).toBe(true);
  await expect(page.getByLabel(`发送到${direct.room.name}`)).toHaveValue("");
  await expect(page.locator(".room-message").filter({ hasText: draft })).toBeVisible();

  if (testInfo.project.name === "mobile-chromium") {
    await page.getByRole("button", { name: "打开房间列表" }).click();
  }
  await page
    .getByRole("button", { name: /切换到.+/ })
    .filter({ hasNotText: direct.room.name })
    .first()
    .click();
  await expect(page.locator(".room-header h1")).not.toHaveText(direct.room.name);
  if (testInfo.project.name === "mobile-chromium") {
    await page.getByRole("button", { name: "打开房间列表" }).click();
  }
  await page.getByRole("button", { name: `切换到${direct.room.name}` }).click();
  await expect(page).toHaveURL(directRoomUrl);
  await expect(page.locator(".room-message").filter({ hasText: draft })).toBeVisible();

  expect(await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  )).toBe(false);
});
