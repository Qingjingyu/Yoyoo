/** @vitest-environment node */

import { randomUUID } from "node:crypto";

import { expect, it } from "vitest";

import { collectAgentEvents } from "@/agents/contract";
import { YosWebConsoleAdapter } from "@/agents/yos-adapter";

const liveEnabled = process.env.YOS_LIVE_TEST === "1";

it.runIf(liveEnabled)("receives one private reply from the configured local YOS", async () => {
  const baseUrl = process.env.YOS_WEB_CONSOLE_URL;
  if (!baseUrl) throw new Error("YOS_WEB_CONSOLE_URL is required for the live test");
  const marker = `YOS_ADAPTER_READY_${randomUUID().slice(0, 8)}`;
  const adapter = new YosWebConsoleAdapter({
    baseUrl,
    password: process.env.YOS_WEB_PASSWORD,
    pollIntervalMs: 500,
    responseTimeoutMs: 180_000,
  });

  await expect(adapter.health()).resolves.toMatchObject({ status: "available" });
  const events = await collectAgentEvents(adapter.run({
    runId: randomUUID(),
    conversationId: randomUUID(),
    message: `Yoyoo 本地接入烟测。请只回复：${marker}`,
  }, new AbortController().signal));

  expect(events.at(-1)).toMatchObject({ type: "completed" });
  expect(JSON.stringify(events)).toContain(marker);
}, 190_000);
