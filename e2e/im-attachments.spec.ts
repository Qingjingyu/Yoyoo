import { expect, test } from "@playwright/test";

test("uploads, sends, refreshes, previews, and downloads a private attachment", async ({
  page,
}, testInfo) => {
  await page.goto("/conversation");
  await expect(page.locator(".room-header h1")).toBeVisible();

  if (testInfo.project.name === "mobile-chromium") {
    await page.getByRole("button", { name: "打开房间列表" }).click();
  }
  const roomName = `文件验收室 ${Date.now()} ${testInfo.project.name}`;
  await page.getByRole("button", { name: "新建房间" }).click();
  await page.getByRole("textbox", { name: "房间名称" }).fill(roomName);
  await page.getByRole("button", { name: "创建房间" }).click();
  await expect(page.locator(".room-header h1")).toHaveText(roomName);

  const filename = `private-${Date.now()}.txt`;
  const content = "Yoyoo attachment browser acceptance";
  await page.getByLabel("添加附件").setInputFiles({
    name: filename,
    mimeType: "text/plain",
    buffer: Buffer.from(content),
  });
  await expect(page.getByText("已就绪")).toBeVisible();
  await expect(page.getByRole("button", { name: "发送消息" })).toBeEnabled();
  const persistedMessage = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      /\/api\/v1\/rooms\/[^/]+\/messages$/u.test(response.url()),
  );
  await page.getByRole("button", { name: "发送消息" }).click();
  expect((await persistedMessage).ok()).toBe(true);

  const messageAttachment = page.locator(".message-attachments").filter({ hasText: filename });
  await expect(messageAttachment).toBeVisible();
  await page.reload();
  await expect(messageAttachment).toBeVisible();
  const preview = messageAttachment.getByRole("link", { name: `预览 ${filename}` });
  const href = await preview.getAttribute("href");
  expect(href).toMatch(/^\/api\/v1\/attachments\/.+\/content\?roomId=/);
  const downloaded = await page.request.get(href!);
  expect(downloaded.ok()).toBe(true);
  expect(await downloaded.text()).toBe(content);
  expect(downloaded.headers()["x-content-type-options"]).toBe("nosniff");

  expect(await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  )).toBe(false);
});
