import { expect, test } from "@playwright/test";

test("owner sees the AI Card identity bridge and explicit authorization outcomes", async ({
  page,
}) => {
  await page.goto("/settings/agents?aicard=connected");

  const connectAgentLink = page.getByRole("link", { name: "接入 AI Card" });
  await expect(connectAgentLink).toHaveAttribute(
    "href",
    "/api/v1/auth/aicard/start?purpose=agent",
  );
  await expect(page.getByRole("link", { name: "连接我的身份" })).toHaveAttribute(
    "href",
    "/api/v1/auth/aicard/start",
  );
  const connectedNotice = page.getByText("AI Card 已连接到当前 Yoyoo 身份。", {
    exact: true,
  });
  await expect(connectedNotice).toHaveAttribute("role", "status");

  await page.goto("/settings/agents?aicard=invalid_session");
  const invalidSessionNotice = page.getByText("授权已失效，请重新连接。", {
    exact: true,
  });
  await expect(invalidSessionNotice).toHaveAttribute("role", "alert");
});

test("owner creates an Agent, sees its credential once, and observes public heartbeat presence", async ({
  page,
}, testInfo) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  await page.goto("/settings/agents");
  await expect(page.getByRole("heading", { name: "AI 接入" })).toBeVisible();

  const suffix = `${Date.now()}-${testInfo.project.name.replace(/[^a-z]/g, "")}`;
  const displayName = `Research ${suffix}`;
  await page.getByRole("button", { name: "兼容接入 AI", exact: true }).click();
  await page.getByRole("textbox", { name: "显示名称" }).fill(displayName);
  await page.getByRole("textbox", { name: "Agent 标识" }).fill(`research-${suffix}`);
  await page.getByRole("button", { name: "创建接入凭据" }).click();

  const credential = page.getByRole("textbox", { name: "Agent 接入凭据" });
  await expect(credential).toBeVisible();
  const token = await credential.inputValue();
  expect(token).toMatch(/^yya_[A-Za-z0-9_-]{43}$/);
  const agentRow = page.getByRole("article").filter({ hasText: displayName });
  await expect(agentRow.getByText(displayName, { exact: true })).toBeVisible();
  await expect(page.getByText("等待连接", { exact: true })).toBeVisible();

  const heartbeat = await page.request.post("/api/v1/agent-gateway/heartbeat", {
    data: {},
    headers: { authorization: `Bearer ${token}` },
  });
  expect(heartbeat.ok()).toBe(true);
  await page.getByRole("button", { name: "关闭接入凭据" }).click();
  await page.reload();

  await expect(agentRow.getByText(displayName, { exact: true })).toBeVisible();
  await expect(agentRow.getByText("在线", { exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Agent 接入凭据" })).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText(token);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    ),
  ).toBe(false);

  if (testInfo.project.name === "mobile-chromium") {
    const targets = await page
      .locator(".agent-directory-header button, .agent-row__actions button")
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
