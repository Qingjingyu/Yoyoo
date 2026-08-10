import { expect, test } from "@playwright/test";

test("one room coordinates three Agents, delegates, persists an Artifact, and accepts intervention", async ({
  page,
}, testInfo) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  await page.goto("/conversation");

  await expect(page.locator(".room-header h1")).toBeVisible();
  const roomName = `协作验收室 ${Date.now()} ${testInfo.project.name}`;
  if (testInfo.project.name === "mobile-chromium") {
    await page.getByRole("button", { name: "打开房间列表" }).click();
  }
  await page.getByRole("button", { name: "新建房间" }).click();
  await page.getByRole("textbox", { name: "房间名称" }).fill(roomName);
  await page.getByRole("button", { name: "创建房间" }).click();
  await expect(page.locator(".room-header h1")).toHaveText(roomName);
  await expect(page.getByRole("button", { name: /选择 Planner 参与协作/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /选择 Builder 参与协作/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /选择 Reviewer 参与协作/ })).toBeVisible();

  const message = `三方协作验收 ${Date.now()} ${testInfo.project.name}`;
  const delegationCount = await page.locator(".delegation-entry").count();
  const artifactCount = await page.locator(".artifact-entry").count();
  await page.getByRole("button", { name: "全员参与" }).click();
  await page.getByRole("textbox", { name: /发送到/ }).fill(message);
  await page.getByRole("button", { name: "发送消息" }).click();

  const submittedArticle = page
    .getByText(message, { exact: true })
    .locator("xpath=ancestor::article");
  await expect(submittedArticle).toBeVisible();
  await expect(submittedArticle.locator('.run-entry[data-status="completed"]')).toHaveCount(
    4,
    { timeout: 8_000 },
  );
  await expect(page.locator(".delegation-entry")).toHaveCount(delegationCount + 1);
  await expect(page.locator(".artifact-entry")).toHaveCount(artifactCount + 2);

  await page.reload();
  await expect(page.getByText(message, { exact: true })).toBeVisible();
  await expect(page.locator(".artifact-entry")).toHaveCount(artifactCount + 2);

  await page.getByRole("button", { name: /选择 Planner 参与协作/ }).click();
  await page.getByRole("button", { name: /选择 Reviewer 参与协作/ }).click();
  const interventionMessage = `人工干预验收 ${Date.now()} ${testInfo.project.name}`;
  await page.getByRole("textbox", { name: /发送到/ }).fill(interventionMessage);
  await page.getByRole("button", { name: "发送消息" }).click();
  const interventionArticle = page
    .getByText(interventionMessage, { exact: true })
    .locator("xpath=ancestor::article");
  const stopReviewer = interventionArticle.getByRole("button", { name: "停止 Reviewer" });
  await expect(stopReviewer).toBeVisible();
  await stopReviewer.click();
  await expect(interventionArticle.getByText("已停止", { exact: true })).toBeVisible({
    timeout: 8_000,
  });
  await expect(page.getByText(/苏白已要求 Reviewer 停止本次执行/).last()).toBeVisible({
    timeout: 8_000,
  });

  const overflow = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    timeline: document.querySelector(".room-timeline__inner")!.scrollWidth
      > document.querySelector(".room-timeline__inner")!.clientWidth,
  }));
  expect(overflow).toEqual({ document: false, timeline: false });
  expect(consoleErrors).toEqual([]);
});

test("room controls remain usable on a compact mobile viewport", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto("/conversation");

  await expect(page.locator(".room-header h1")).toBeVisible();
  await expect(page.getByRole("textbox", { name: /发送到/ })).toBeVisible();
  const coreControls = await page
    .locator(".room-composer__send, .sidebar__link")
    .evaluateAll((controls) =>
      controls.map((control) => {
        const box = control.getBoundingClientRect();
        return { height: box.height, width: box.width };
      }),
    );
  expect(coreControls.every(({ height, width }) => height >= 44 && width >= 44)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
});

test("multiple rooms keep messages isolated and restore the selected room after refresh", async ({
  page,
}, testInfo) => {
  await page.goto("/conversation");
  await expect(page.locator(".room-header h1")).toBeVisible();

  const suffix = `${Date.now()}-${testInfo.project.name}`;
  const firstRoomName = `规划室 ${suffix}`;
  const secondRoomName = `评审室 ${suffix}`;
  const firstMessage = `规划房间独立消息 ${suffix}`;
  const secondMessage = `评审房间独立消息 ${suffix}`;
  const timeline = page.locator(".room-timeline");

  async function openRoomRail() {
    if (testInfo.project.name === "mobile-chromium") {
      await page.getByRole("button", { name: "打开房间列表" }).click();
    }
  }

  async function createNamedRoom(name: string) {
    await openRoomRail();
    await page.getByRole("button", { name: "新建房间" }).click();
    await page.getByRole("textbox", { name: "房间名称" }).fill(name);
    await page.getByRole("button", { name: "创建房间" }).click();
    await expect(page.locator(".room-header h1")).toHaveText(name);
  }

  await createNamedRoom(firstRoomName);
  const firstRoomUrl = page.url();
  await page.getByRole("textbox", { name: /发送到/ }).fill(firstMessage);
  await page.getByRole("button", { name: "发送消息" }).click();
  await expect(timeline.getByText(firstMessage, { exact: true })).toBeVisible();

  await createNamedRoom(secondRoomName);
  const secondRoomUrl = page.url();
  await expect(timeline.getByText(firstMessage, { exact: true })).toHaveCount(0);
  await page.getByRole("textbox", { name: /发送到/ }).fill(secondMessage);
  const persistedMessage = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      /\/api\/v1\/rooms\/[^/]+\/messages$/.test(response.url()),
  );
  await page.getByRole("button", { name: "发送消息" }).click();
  expect((await persistedMessage).ok()).toBe(true);
  await expect(timeline.getByText(secondMessage, { exact: true })).toBeVisible();

  await page.reload();
  await expect(page).toHaveURL(secondRoomUrl);
  await expect(page.locator(".room-header h1")).toHaveText(secondRoomName);
  await expect(timeline.getByText(secondMessage, { exact: true })).toBeVisible();
  await expect(timeline.getByText(firstMessage, { exact: true })).toHaveCount(0);

  await page.goto(firstRoomUrl);
  await expect(page.locator(".room-header h1")).toHaveText(firstRoomName);
  await expect(timeline.getByText(firstMessage, { exact: true })).toBeVisible();
  await expect(timeline.getByText(secondMessage, { exact: true })).toHaveCount(0);
});

test("room lifecycle keeps history recoverable through rename, archive, and restore", async ({
  page,
}, testInfo) => {
  await page.goto("/conversation");
  await expect(page.locator(".room-header h1")).toBeVisible();

  const suffix = `${Date.now()}-${testInfo.project.name}`;
  const initialName = `生命周期验收室 ${suffix}`;
  const renamedName = `已命名协作室 ${suffix}`;

  async function openRoomRail() {
    if (testInfo.project.name === "mobile-chromium") {
      await page.getByRole("button", { name: "打开房间列表" }).click();
    }
  }

  await openRoomRail();
  await page.getByRole("button", { name: "新建房间" }).click();
  await page.getByRole("textbox", { name: "房间名称" }).fill(initialName);
  await page.getByRole("button", { name: "创建房间" }).click();
  await expect(page.locator(".room-header h1")).toHaveText(initialName);

  await openRoomRail();
  await page.getByRole("button", { name: `管理${initialName}` }).click();
  const details = page.getByRole("complementary", { name: `${initialName}详情` });
  await expect(details).toBeVisible();
  await details.getByRole("button", { name: "移除 Builder" }).click();
  await details.getByRole("button", { name: "确认移除 Builder" }).click();
  await expect(details.getByRole("button", { name: "添加 Builder" })).toBeVisible();
  await expect(page.getByRole("button", { name: /选择 Builder 参与协作/ })).toHaveCount(0);
  await details.getByRole("button", { name: "添加 Builder" }).click();
  await expect(details.getByRole("button", { name: "移除 Builder" })).toBeVisible();
  await expect(page.getByRole("button", { name: /选择 Builder 参与协作/ })).toBeVisible();

  await details.getByRole("button", { name: "重命名房间" }).click();
  await details.getByRole("textbox", { name: "房间名称" }).fill(renamedName);
  await page.getByRole("button", { name: "保存房间名称" }).click();
  await expect(page.locator(".room-header h1")).toHaveText(renamedName);

  const renamedDetails = page.getByRole("complementary", { name: `${renamedName}详情` });
  await renamedDetails.getByRole("button", { name: "归档房间" }).click();
  await page.getByRole("button", { name: "确认归档" }).click();
  await expect(page.locator(".room-header h1")).not.toHaveText(renamedName);

  await openRoomRail();
  await page.getByRole("button", { name: "显示已归档房间" }).click();
  await page.getByRole("button", { name: `恢复${renamedName}` }).click();
  await expect(page.getByRole("button", { name: `切换到${renamedName}` })).toBeVisible();
});
