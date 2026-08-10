/** @vitest-environment node */

import { randomUUID } from "node:crypto";

import { expect, it } from "vitest";

import { closeServerRuntime, getServerRuntime } from "@/server/runtime";

const liveEnabled =
  process.env.CODEX_LIVE_TEST === "1" && process.env.YOS_LIVE_TEST === "1";
const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgresql://yoyoo:yoyoo_dev@127.0.0.1:55432/yoyoo_space";

it.runIf(liveEnabled)(
  "runs Codex and YOS independently and together in one persistent room",
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
      process.env.YOYOO_LOCAL_OWNER_ID = `codex-yos-live-${randomUUID()}`;

      let runtime = await getServerRuntime();
      const codexMember = runtime.collaboration.bootstrap.agents.find(
        (agent) => agent.binding.adapterId === "codex-cli",
      );
      const yosMember = runtime.collaboration.bootstrap.agents.find(
        (agent) => agent.binding.adapterId === "yos-web-console",
      );
      expect(codexMember?.principal.displayName).toBe("Codex");
      expect(yosMember?.principal.displayName).toBe("YOS");

      const submitAndWait = async (
        content: string,
        mentionedPrincipalIds: string[],
      ) => {
        const submission = await runtime.collaboration.service.submitMessage({
          roomId: runtime.collaboration.bootstrap.room.id,
          senderPrincipalId: runtime.collaboration.bootstrap.principal.id,
          content,
          idempotencyKey: randomUUID(),
          mentionedPrincipalIds,
        });
        await Promise.all(
          submission.runs.map((run) =>
            runtime.collaboration.coordinator.waitFor(run.id, 210_000),
          ),
        );
        return submission;
      };

      const getRunOutput = async (runId: string) => {
        const snapshot = await runtime.collaboration.service.getSnapshot(
          runtime.collaboration.bootstrap.room.id,
        );
        const run = snapshot.runs.find((candidate) => candidate.id === runId);
        expect(run?.status).toBe("completed");
        const output = snapshot.messages.find(
          (message) => message.id === run?.outputMessageId,
        );
        expect(output?.status).toBe("completed");
        return output!.content;
      };

      const codexSubmission = await submitAndWait(
        "生成一个以 CODEX_FACT_ 开头、后接 8 位大写字母或数字的随机标记，只回复完整标记。",
        [codexMember!.principal.id],
      );
      expect(codexSubmission.runs).toHaveLength(1);
      expect(codexSubmission.runs[0].adapterId).toBe("codex-cli");
      const codexOutput = await getRunOutput(codexSubmission.runs[0].id);
      const codexMarker = codexOutput.match(/CODEX_FACT_[A-Z0-9]{8}/)?.[0];
      expect(codexMarker).toBeDefined();
      if (!codexMarker) throw new Error("Codex did not generate the required marker");

      const yosSubmission = await submitAndWait(
        "生成一个以 YOS_FACT_ 开头、后接 8 位大写字母或数字的随机标记，只回复完整标记。",
        [yosMember!.principal.id],
      );
      expect(yosSubmission.runs).toHaveLength(1);
      expect(yosSubmission.runs[0].adapterId).toBe("yos-web-console");
      const yosOutput = await getRunOutput(yosSubmission.runs[0].id);
      const yosMarker = yosOutput.match(/YOS_FACT_[A-Z0-9]{8}/)?.[0];
      expect(yosMarker).toBeDefined();
      if (!yosMarker) throw new Error("YOS did not generate the required marker");

      const codexCrossSubmission = await submitAndWait(
        "从最近房间历史中找出由 YOS 回复、以 YOS_FACT_ 开头的完整标记，只回复该标记。",
        [codexMember!.principal.id],
      );
      const codexCrossOutput = await getRunOutput(codexCrossSubmission.runs[0].id);
      expect(codexCrossOutput).toContain(yosMarker);

      const yosCrossSubmission = await submitAndWait(
        "从最近房间历史中找出由 Codex 回复、以 CODEX_FACT_ 开头的完整标记，只回复该标记。",
        [yosMember!.principal.id],
      );
      const yosCrossOutput = await getRunOutput(yosCrossSubmission.runs[0].id);
      expect(yosCrossOutput).toContain(codexMarker);

      const sharedMarker = `CODEX_YOS_TOGETHER_${randomUUID().slice(0, 8)}`;
      const sharedSubmission = await submitAndWait(
        `Yoyoo 真实协作验收。请在回复中原样包含：${sharedMarker}`,
        [codexMember!.principal.id, yosMember!.principal.id],
      );
      expect(sharedSubmission.runs.map((run) => run.adapterId).sort()).toEqual([
        "codex-cli",
        "yos-web-console",
      ]);

      const roomId = runtime.collaboration.bootstrap.room.id;
      await closeServerRuntime();
      runtime = await getServerRuntime();
      const restored = await runtime.collaboration.service.getSnapshot(roomId);
      for (const [principalId, marker] of [
        [codexMember!.principal.id, codexMarker],
        [yosMember!.principal.id, yosMarker],
        [codexMember!.principal.id, yosMarker],
        [yosMember!.principal.id, codexMarker],
        [codexMember!.principal.id, sharedMarker],
        [yosMember!.principal.id, sharedMarker],
      ] as const) {
        expect(restored.messages).toContainEqual(
          expect.objectContaining({
            senderPrincipalId: principalId,
            content: expect.stringContaining(marker),
            status: "completed",
          }),
        );
      }
    } finally {
      await closeServerRuntime();
      restore("DATABASE_URL");
      restore("YOYOO_AGENT_ADAPTER");
      restore("YOYOO_LOCAL_OWNER_ID");
    }
  },
  800_000,
);
