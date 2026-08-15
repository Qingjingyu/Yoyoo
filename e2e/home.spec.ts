import { expect, test } from "@playwright/test";

test("homepage stays focused, aligned, and free of horizontal overflow", async ({
  page,
}, testInfo) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  await page.goto("/");

  await expect(page.getByRole("heading", {
    name: /^(夜深了|早上好|下午好|晚上好)，Su Bai。$/,
  })).toBeVisible();
  await expect(page.getByText("Yoyoo 在线")).toBeVisible();
  await expect(page.locator(".space-backdrop")).toHaveCount(0);
  await expect(page.locator(".presence-scene")).toHaveCount(0);
  await expect(page.getByRole("img", { name: /Yoyoo 数字生命/ })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "最近对话" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "开始语音对话" })).toHaveCount(0);
  await expect(page.getByText("01", { exact: true })).toHaveCount(0);

  if (testInfo.project.name === "desktop-chromium") {
    const centers = await page.locator(".sidebar a").evaluateAll((links) =>
      links.map((link) => {
        const box = link.getBoundingClientRect();
        return box.left + box.width / 2;
      }),
    );
    expect(new Set(centers.map((center) => Math.round(center))).size).toBe(1);

    const brandBox = await page.getByRole("link", { name: "Yoyoo Space" }).first().boundingBox();
    const navBox = await page.getByRole("navigation", { name: "主导航" }).boundingBox();
    expect(Math.round((navBox?.y ?? 0) - ((brandBox?.y ?? 0) + (brandBox?.height ?? 0)))).toBe(
      24,
    );
    expect((navBox?.y ?? 900) + (navBox?.height ?? 0)).toBeLessThan(240);
  }

  const hasHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(hasHorizontalOverflow).toBe(false);
  expect(consoleErrors).toEqual([]);
});

test("compact mobile controls retain full touch targets", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto("/");

  const controlBoxes = await page.locator(".composer button, .sidebar__link").evaluateAll((controls) =>
    controls.map((control) => {
      const box = control.getBoundingClientRect();
      return { height: box.height, width: box.width };
    }),
  );

  expect(controlBoxes.every(({ height, width }) => height >= 44 && width >= 44)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
});

test("image-free spatial canvas fills the viewport behind a centered conversation rail", async ({
  page,
}, testInfo) => {
  await page.goto("/");

  await expect(page.locator(".space-backdrop")).toHaveCount(0);
  const shell = page.locator(".space-shell");
  await expect(shell).toBeVisible();
  const shellBox = await shell.boundingBox();
  const viewport = page.viewportSize();
  expect(shellBox?.width ?? 0).toBeGreaterThanOrEqual(viewport?.width ?? 0);
  expect(shellBox?.height ?? 0).toBeGreaterThanOrEqual(viewport?.height ?? 0);
  expect(
    await shell.evaluate((element) => getComputedStyle(element).backgroundImage),
  ).toBe("none");

  if (testInfo.project.name === "desktop-chromium") {
    const focusBox = await page.locator(".home-focus").boundingBox();
    const contentCenter = 64 + ((viewport?.width ?? 1440) - 64) / 2;
    const focusCenter = (focusBox?.x ?? 0) + (focusBox?.width ?? 0) / 2;
    expect(Math.abs(focusCenter - contentCenter)).toBeLessThanOrEqual(2);
  }
});

test("homepage does not expose simulated voice controls", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("textbox", { name: "给 Yoyoo 发消息" })).toBeVisible();
  await expect(page.getByRole("button", { name: "开始语音对话" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Yoyoo Live" })).toHaveCount(0);
  await expect(page.locator(".presence-scene")).toHaveCount(0);
  await expect(page.getByLabel(/Yoyoo 数字生命/)).toHaveCount(0);
});

test("standalone Orb study is not a public product route", async ({ page }) => {
  const response = await page.goto("/orb-preview");
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "Yoyoo" })).toHaveCount(0);
});

test("homepage stays concise while the dedicated conversation uses the full viewport", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  await expect(page.getByRole("heading", {
    name: /^(夜深了|早上好|下午好|晚上好)，Su Bai。$/,
  })).toBeVisible();
  await expect(page.getByLabel("当前对话")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "对话", exact: true })).toHaveAttribute(
    "href",
    "/conversation",
  );

  await page.getByRole("link", { name: "对话", exact: true }).click();
  await expect(page).toHaveURL(/\/conversation\?room=[0-9a-f-]+$/);
  await expect(page.locator(".room-stage")).toBeVisible();
  await expect(page.locator(".room-header h1")).toBeVisible();
  await expect(page.locator(".room-timeline")).toBeVisible();

  const viewport = page.viewportSize();
  const threadBox = await page.locator(".room-timeline").boundingBox();
  const composerBox = await page.locator(".room-composer").boundingBox();

  expect(threadBox?.height ?? 0).toBeGreaterThan(
    testInfo.project.name === "desktop-chromium" ? 420 : 260,
  );
  expect((viewport?.height ?? 0) - ((composerBox?.y ?? 0) + (composerBox?.height ?? 0)))
    .toBeLessThanOrEqual(testInfo.project.name === "desktop-chromium" ? 32 : 88);
});
