import { expect, test } from "@playwright/test";

for (const theme of ["light", "dark"] as const) {
  test(`${theme} theme is image-free, persistent, and spatially complete`, async ({
    page,
  }) => {
    await page.addInitScript((preference) => {
      window.localStorage.setItem("yoyoo-theme", preference);
    }, theme);

    await page.goto("/");

    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await expect(page.locator(".space-backdrop")).toHaveCount(0);

    const homeTheme = await page.evaluate(() => {
      const styles = getComputedStyle(document.documentElement);
      const sidebarStyles = getComputedStyle(document.querySelector(".sidebar")!);
      return {
        canvas: styles.getPropertyValue("--surface-canvas").trim(),
        panel: styles.getPropertyValue("--surface-panel").trim(),
        text: styles.getPropertyValue("--text-primary").trim(),
        border: styles.getPropertyValue("--border-default").trim(),
        bodyBackground: getComputedStyle(document.body).backgroundColor,
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        desktopSidebar: window.matchMedia("(min-width: 48.01rem)").matches
          ? {
              borderRight: Number.parseFloat(sidebarStyles.borderRightWidth),
              shadow: sidebarStyles.boxShadow,
            }
          : null,
      };
    });

    expect(homeTheme.canvas).not.toBe("");
    expect(homeTheme.panel).not.toBe("");
    expect(homeTheme.text).not.toBe("");
    expect(homeTheme.border).not.toBe("");
    expect(homeTheme.bodyBackground).not.toBe("rgba(0, 0, 0, 0)");
    expect(homeTheme.overflow).toBe(0);
    if (homeTheme.desktopSidebar) {
      expect(homeTheme.desktopSidebar.borderRight).toBe(0);
      expect(homeTheme.desktopSidebar.shadow).not.toContain("inset");
    }

    await page.goto("/conversation");
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await expect(page.locator(".room-shell")).toBeVisible();
    await expect(page.locator(".space-backdrop")).toHaveCount(0);
    await expect(page.locator(".room-rail__item[data-active]")).toBeVisible();
    await expect(page.locator(".room-composer textarea")).toBeVisible();

    const conversationCraft = await page.evaluate(() => {
      const fontSize = (selector: string) => {
        const element = document.querySelector(selector);
        return element ? Number.parseFloat(getComputedStyle(element).fontSize) : 0;
      };
      const material = (selector: string) => {
        const element = document.querySelector(selector);
        if (!element) return { alpha: 0, blur: 0, shadow: "missing" };
        const styles = getComputedStyle(element);
        const colorParts = styles.backgroundColor.match(/[\d.]+/g)?.map(Number) ?? [];
        const backdrop = styles.backdropFilter
          || styles.getPropertyValue("-webkit-backdrop-filter");
        const blur = Number.parseFloat(backdrop.match(/blur\(([\d.]+)px\)/)?.[1] ?? "0");
        return {
          alpha: colorParts.length >= 4 ? colorParts[3] : 1,
          blur,
          shadow: styles.boxShadow,
        };
      };
      const resolvedColor = (property: "color" | "backgroundColor", token: string) => {
        const probe = document.createElement("span");
        probe.style[property] = `var(${token})`;
        document.body.append(probe);
        const value = getComputedStyle(probe)[property];
        probe.remove();
        return value;
      };
      const activeRoom = document.querySelector(".room-rail__item[data-active]");
      const focusedMessage = document.createElement("article");
      focusedMessage.className = "room-message";
      focusedMessage.setAttribute("data-focused", "true");
      const focusedMessageContent = document.createElement("div");
      focusedMessageContent.className = "room-message__content";
      focusedMessage.append(focusedMessageContent);
      document.body.append(focusedMessage);

      const borderWidth = (selector: string, side: "right" | "bottom" | "top") => {
        const element = document.querySelector(selector);
        if (!element) return -1;
        const styles = getComputedStyle(element);
        const value = side === "right"
          ? styles.borderRightWidth
          : side === "bottom"
            ? styles.borderBottomWidth
            : styles.borderTopWidth;
        return Number.parseFloat(value);
      };

      const focusedMessageCraft = {
        frameShadow: getComputedStyle(focusedMessage).boxShadow,
        bubbleBorder: Number.parseFloat(
          getComputedStyle(focusedMessageContent).borderTopWidth,
        ),
        bubbleBackground: getComputedStyle(focusedMessageContent).backgroundColor,
        bubbleShadow: getComputedStyle(focusedMessageContent).boxShadow,
      };
      focusedMessage.remove();

      return {
        accent: resolvedColor("color", "--accent"),
        selectedSurface: resolvedColor("backgroundColor", "--surface-selected"),
        railMetadataSize: fontSize(".room-rail__header span"),
        roomTitleSize: fontSize(".room-rail__summary strong"),
        composerCopySize: fontSize(".room-composer textarea"),
        activeRoomStripeWidth: activeRoom
          ? Number.parseFloat(getComputedStyle(activeRoom, "::before").width)
          : -1,
        structuralBorders: {
          sidebarRight: borderWidth(".sidebar", "right"),
          railRight: borderWidth(".room-rail", "right"),
          headerBottom: borderWidth(".room-header", "bottom"),
          activeRoom: borderWidth(".room-rail__item[data-active]", "top"),
        },
        focusedMessage: focusedMessageCraft,
        sidebarMaterial: material(".sidebar"),
        railMaterial: material(".room-rail"),
        headerMaterial: material(".room-header"),
        composerMaterial: material(".room-composer"),
        readingSurfaceMaterial: material(".room-stage"),
      };
    });

    expect(conversationCraft.railMetadataSize).toBeGreaterThanOrEqual(11);
    expect(conversationCraft.roomTitleSize).toBeGreaterThanOrEqual(12);
    expect(conversationCraft.composerCopySize).toBeGreaterThanOrEqual(14);
    expect(conversationCraft.activeRoomStripeWidth).toBe(0);
    expect(conversationCraft.structuralBorders).toEqual({
      sidebarRight: 0,
      railRight: 0,
      headerBottom: 0,
      activeRoom: 0,
    });
    expect(conversationCraft.focusedMessage).not.toBeNull();
    expect(conversationCraft.focusedMessage?.frameShadow).toBe("none");
    expect(conversationCraft.focusedMessage?.bubbleBorder).toBe(0);
    expect(conversationCraft.focusedMessage?.bubbleBackground).toBe(
      conversationCraft.selectedSurface,
    );
    expect(conversationCraft.focusedMessage?.bubbleShadow).not.toBe("none");

    for (const color of [conversationCraft.accent, conversationCraft.selectedSurface]) {
      const channels = color.match(/[\d.]+/g)?.map(Number) ?? [];
      expect(channels.length).toBeGreaterThanOrEqual(3);
      expect(channels[2], `${color} should lean ice-blue, not teal`).toBeGreaterThan(
        channels[1],
      );
    }

    for (const [surface, material] of Object.entries({
      sidebar: conversationCraft.sidebarMaterial,
      rail: conversationCraft.railMaterial,
      header: conversationCraft.headerMaterial,
      composer: conversationCraft.composerMaterial,
    })) {
      expect.soft(material.alpha, `${surface} alpha`).toBeGreaterThanOrEqual(0.55);
      expect.soft(material.alpha, `${surface} alpha`).toBeLessThanOrEqual(0.92);
      expect.soft(material.blur, `${surface} blur`).toBeGreaterThanOrEqual(18);
      expect.soft(material.blur, `${surface} blur`).toBeLessThanOrEqual(32);
      expect.soft(material.shadow, `${surface} shadow`).not.toBe("none");
    }

    expect(conversationCraft.readingSurfaceMaterial.alpha).toBeGreaterThanOrEqual(0.95);
    expect(conversationCraft.readingSurfaceMaterial.blur).toBe(0);

    const roomOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(roomOverflow).toBe(0);

    await page.goto("/settings/agents");
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await expect(page.locator(".agent-directory-shell")).toBeVisible();
    await expect(page.locator(".space-backdrop")).toHaveCount(0);
    const settingsSidebar = await page.evaluate(() => {
      if (!window.matchMedia("(min-width: 48.01rem)").matches) return null;
      const styles = getComputedStyle(document.querySelector(".sidebar")!);
      return {
        borderRight: Number.parseFloat(styles.borderRightWidth),
        shadow: styles.boxShadow,
      };
    });
    if (settingsSidebar) {
      expect(settingsSidebar.borderRight).toBe(0);
      expect(settingsSidebar.shadow).not.toContain("inset");
    }
  });
}

test("settings theme control persists across refresh and navigation", async ({ page }) => {
  await page.goto("/settings/agents");

  await page.getByRole("button", { name: "深色" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(await page.evaluate(() => localStorage.getItem("yoyoo-theme"))).toBe("dark");

  await page.reload();
  await expect(page.getByRole("button", { name: "深色" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.goto("/conversation");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  await page.goto("/settings/agents");
  await page.getByRole("button", { name: "浅色" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  expect(await page.evaluate(() => localStorage.getItem("yoyoo-theme"))).toBe("light");
});
