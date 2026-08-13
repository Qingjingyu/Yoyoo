import { expect, test } from "@playwright/test";

test("owner sees the AI Card identity bridge and explicit authorization outcomes", async ({
  page,
}) => {
  await page.goto("/settings/agents?aicard=connected");

  const connectAgentLink = page.locator(".agent-directory-header").getByRole(
    "link",
    { name: "授权 AI 接入" },
  );
  await expect(connectAgentLink).toHaveAttribute(
    "href",
    "/api/v1/auth/aicard/start?purpose=agent",
  );
  await expect(page.getByRole("link", { name: "连接我的身份" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "我的 AI Card" })).toHaveCount(0);
  const connectedNotice = page.getByText("统一 AI Card 身份已确认。", {
    exact: true,
  });
  await expect(connectedNotice).toHaveAttribute("role", "status");

  await page.goto("/settings/agents?aicard=invalid_session");
  const invalidSessionNotice = page.getByText("授权已失效，请重新连接。", {
    exact: true,
  });
  await expect(invalidSessionNotice).toHaveAttribute("role", "alert");
});

test("owner can only authorize an external AI that already owns an AI Card", async ({
  page,
}, testInfo) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  await page.goto("/settings/agents");
  await expect(page.getByRole("heading", { name: "AI 接入" })).toBeVisible();

  const authorizationLink = page.locator(".agent-directory-header").getByRole(
    "link",
    { name: "授权 AI 接入" },
  );
  await expect(authorizationLink).toHaveAttribute(
    "href",
    "/api/v1/auth/aicard/start?purpose=agent",
  );
  await expect(page.getByRole("button", { name: "兼容接入 AI" })).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "显示名称" })).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "Agent 标识" })).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    ),
  ).toBe(false);

  if (testInfo.project.name === "mobile-chromium") {
    const targets = await page
      .locator(".agent-directory-header a, .agent-directory-header button, .agent-row__actions button")
      .evaluateAll((controls) =>
        controls.map((control) => {
          const box = control.getBoundingClientRect();
          return { height: box.height, width: box.width };
        }),
      );
    expect(targets.every(({ height, width }) => height >= 44 && width >= 44)).toBe(true);
  }
  expect(consoleErrors).toEqual([]);
});
