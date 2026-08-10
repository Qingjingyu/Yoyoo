/** @vitest-environment node */

import { randomUUID } from "node:crypto";

import { expect, it } from "vitest";

import { closeServerRuntime, getServerRuntime } from "@/server/runtime";

const liveEnabled = process.env.YOS_LIVE_TEST === "1";
const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgresql://yoyoo:yoyoo_dev@127.0.0.1:55432/yoyoo_space";

it.runIf(liveEnabled)(
  "runs the configured YOS Agent inside a persistent collaboration room",
  async () => {
    const priorEnvironment = {
      DATABASE_URL: process.env.DATABASE_URL,
      YOYOO_AGENT_ADAPTER: process.env.YOYOO_AGENT_ADAPTER,
      YOYOO_LOCAL_OWNER_ID: process.env.YOYOO_LOCAL_OWNER_ID,
    };
    const restore = (key: keyof typeof priorEnvironment) => {
      const value = priorEnvironment[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    };

    try {
      await closeServerRuntime();
      process.env.DATABASE_URL = databaseUrl;
      process.env.YOYOO_AGENT_ADAPTER = "yos-web-console";
      process.env.YOYOO_LOCAL_OWNER_ID = `yos-room-live-${randomUUID()}`;

      const runtime = await getServerRuntime();
      const yosMember = runtime.collaboration.bootstrap.agents.find(
        (agent) => agent.binding.adapterId === "yos-web-console",
      );
      expect(runtime.collaboration.bootstrap.agents).toHaveLength(3);
      expect(yosMember?.principal.displayName).toBe("YOS");
      expect(yosMember?.binding.capabilities).toMatchObject({
        streaming: false,
        cancellation: false,
      });

      const marker = `YOS_ROOM_READY_${randomUUID().slice(0, 8)}`;
      const submission = await runtime.collaboration.service.submitMessage({
        roomId: runtime.collaboration.bootstrap.room.id,
        senderPrincipalId: runtime.collaboration.bootstrap.principal.id,
        content: `Yoyoo 协作房间烟测。请只回复：${marker}`,
        idempotencyKey: randomUUID(),
        mentionedPrincipalIds: [yosMember!.principal.id],
      });

      expect(submission.runs).toHaveLength(1);
      expect(submission.runs[0]).toMatchObject({
        adapterId: "yos-web-console",
        targetAgentPrincipalId: yosMember!.principal.id,
      });
      await runtime.collaboration.coordinator.waitFor(submission.runs[0].id, 190_000);

      expect(await runtime.collaboration.runs.get(submission.runs[0].id)).toMatchObject({
        status: "completed",
      });
      const restored = await runtime.collaboration.service.getSnapshot(
        runtime.collaboration.bootstrap.room.id,
      );
      expect(restored.messages).toContainEqual(
        expect.objectContaining({
          senderPrincipalId: yosMember!.principal.id,
          content: expect.stringContaining(marker),
          status: "completed",
        }),
      );
    } finally {
      await closeServerRuntime();
      restore("DATABASE_URL");
      restore("YOYOO_AGENT_ADAPTER");
      restore("YOYOO_LOCAL_OWNER_ID");
    }
  },
  200_000,
);
