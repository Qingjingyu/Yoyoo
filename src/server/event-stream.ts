import type { RunRepository } from "@/server/postgres/run-repository";
import type { CollaborationRunRepository } from "@/server/postgres/collaboration-run-repository";

const terminalTypes = new Set(["completed", "failed", "stopped"]);
const encoder = new TextEncoder();

function pause(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      signal.removeEventListener("abort", handleAbort);
      resolve();
    }, milliseconds);
    const handleAbort = () => {
      clearTimeout(timeout);
      resolve();
    };
    signal.addEventListener("abort", handleAbort, { once: true });
  });
}

export function createRunEventResponse(
  runs: RunRepository,
  runId: string,
  afterSequence: number,
  signal: AbortSignal,
): Response {
  let cursor = afterSequence;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        while (!signal.aborted) {
          const events = await runs.listEvents(runId, cursor);
          for (const stored of events) {
            cursor = stored.sequence;
            controller.enqueue(
              encoder.encode(
                `id: ${stored.sequence}\nevent: ${stored.event.type}\ndata: ${JSON.stringify({
                  runId,
                  ...stored.event,
                })}\n\n`,
              ),
            );
            if (terminalTypes.has(stored.event.type)) {
              controller.close();
              return;
            }
          }

          const run = await runs.get(runId);
          if (terminalTypes.has(run.status)) {
            const finalEvents = await runs.listEvents(runId, cursor);
            for (const stored of finalEvents) {
              cursor = stored.sequence;
              controller.enqueue(
                encoder.encode(
                  `id: ${stored.sequence}\nevent: ${stored.event.type}\ndata: ${JSON.stringify({
                    runId,
                    ...stored.event,
                  })}\n\n`,
                ),
              );
            }
            controller.close();
            return;
          }
          await pause(40, signal);
        }
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
  });

  return new Response(stream, {
    headers: {
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "content-type": "text/event-stream; charset=utf-8",
      "x-accel-buffering": "no",
    },
  });
}

export function createCollaborationRunEventResponse(
  runs: CollaborationRunRepository,
  runId: string,
  afterSequence: number,
  signal: AbortSignal,
): Response {
  let cursor = afterSequence;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        while (!signal.aborted) {
          const events = await runs.listEvents(runId, cursor);
          for (const stored of events) {
            cursor = stored.sequence;
            controller.enqueue(
              encoder.encode(
                `id: ${stored.sequence}\nevent: ${stored.event.type}\ndata: ${JSON.stringify({
                  runId,
                  ...stored.event,
                })}\n\n`,
              ),
            );
            if (terminalTypes.has(stored.event.type)) {
              controller.close();
              return;
            }
          }
          const run = await runs.get(runId);
          if (terminalTypes.has(run.status)) {
            const finalEvents = await runs.listEvents(runId, cursor);
            for (const stored of finalEvents) {
              cursor = stored.sequence;
              controller.enqueue(
                encoder.encode(
                  `id: ${stored.sequence}\nevent: ${stored.event.type}\ndata: ${JSON.stringify({
                    runId,
                    ...stored.event,
                  })}\n\n`,
                ),
              );
            }
            controller.close();
            return;
          }
          await pause(40, signal);
        }
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
  });
  return new Response(stream, {
    headers: {
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "content-type": "text/event-stream; charset=utf-8",
      "x-accel-buffering": "no",
    },
  });
}
