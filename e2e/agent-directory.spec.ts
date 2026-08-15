import { expect, test } from "@playwright/test";

const roomId = "188a9734-b236-4a9b-a3ae-d9134f390fcf";
const invitationId = "cf740f76-ea2f-4bb3-8eab-96ca201b8a22";

test("owner generates one complete Agent onboarding instruction inside Yoyoo", async ({
  page,
}, testInfo) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  await page.route("**/api/v1/rooms", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      rooms: [{ id: roomId, name: "产品研究", status: "active" }],
    }),
  }));
  await page.route("**/api/v1/workspaces/current/agent-invitations", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ invitations: [] }),
      });
      return;
    }
    expect(route.request().postDataJSON()).toEqual({
      displayName: "研究助手",
      roomIds: [roomId],
      permissions: ["message.read", "message.write"],
    });
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        invitation: {
          invitationId,
          displayName: "研究助手",
          roomIds: [roomId],
          permissions: ["message.read", "message.write"],
          status: "pending",
          expiresAt: "2026-08-16T03:00:00.000Z",
          cardId: null,
          principalId: null,
          nodeId: null,
          createdAt: "2026-08-16T02:45:00.000Z",
          admittedAt: null,
          instructions: "请将当前 Agent 接入 Yoyoo：完整自动接入说明",
        },
      }),
    });
  });

  await page.goto("/settings/agents");
  await expect(page.getByRole("heading", { name: "AI 接入" })).toBeVisible();
  await expect(page.getByRole("link", { name: "授权 AI 接入" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "兼容接入 AI" })).toHaveCount(0);

  await page.getByRole("button", { name: "接入 Agent" }).click();
  const dialog = page.getByRole("dialog", { name: "接入 Agent" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("textbox", { name: "Agent 昵称" }).fill("研究助手");
  await dialog.getByRole("checkbox", { name: /产品研究/ }).check();
  await dialog.getByRole("button", { name: "生成接入说明" }).click();
  await expect(dialog.getByLabel("完整 Agent 接入说明")).toHaveValue(
    "请将当前 Agent 接入 Yoyoo：完整自动接入说明",
  );
  await expect(dialog.getByRole("button", { name: "复制完整接入说明" })).toBeVisible();

  expect(await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  )).toBe(false);
  if (testInfo.project.name === "mobile-chromium") {
    const controls = await dialog.locator("button, .agent-admission-option").evaluateAll((elements) =>
      elements.map((element) => {
        const box = element.getBoundingClientRect();
        return { width: box.width, height: box.height };
      }),
    );
    expect(controls.filter(({ width, height }) => width > 0 && height > 0)
      .every(({ height }) => height >= 40)).toBe(true);
  }
  expect(consoleErrors).toEqual([]);
});

test("owner views the current AI Card in place without leaving Yoyoo", async ({ page }) => {
  await page.route("**/api/v1/auth/session", async (route) => {
    if (route.request().method() !== "GET") {
      await route.continue();
      return;
    }
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        authenticated: true,
        identity: {
          aiCardId: "AI_100001",
          loginHandle: "subai",
          displayName: "苏白",
        },
      }),
    });
  });
  await page.goto("/settings/agents?aicard=connected");
  await expect(page.getByText("统一 AI Card 身份已确认。", { exact: true }))
    .toHaveAttribute("role", "status");
  await expect(page.getByRole("link", { name: "我的 AI Card" })).toHaveCount(0);
  await page.getByRole("button", { name: "我的 AI Card" }).click();
  const dialog = page.getByRole("dialog", { name: "我的 AI Card" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("永久身份编号")).toBeVisible();
  await expect(page).toHaveURL(/\/settings\/agents\?aicard=connected$/u);
});
