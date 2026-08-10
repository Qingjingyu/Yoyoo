import { z } from "zod";

import { databaseIdSchema } from "@/domain/id";
import { errorResponse } from "@/server/http-response";
import { getServerRuntime } from "@/server/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const resultSchema = z
  .object({
    leaseId: databaseIdSchema,
    result: z.discriminatedUnion("type", [
      z.object({
        type: z.literal("completed"),
        text: z.string().max(1_000_000),
        attachmentIds: z.array(databaseIdSchema).max(10).optional(),
      }).strict(),
      z
        .object({
          type: z.literal("failed"),
          error: z
            .object({
              code: z.string().trim().min(1).max(80),
              message: z.string().trim().min(1).max(240),
              retriable: z.boolean(),
            })
            .strict(),
        })
        .strict(),
    ]),
  })
  .strict();

export async function POST(
  request: Request,
  context: { params: Promise<{ jobId: string }> },
): Promise<Response> {
  try {
    const { jobId: rawJobId } = await context.params;
    const jobId = databaseIdSchema.parse(rawJobId);
    const body = resultSchema.parse(await request.json());
    const { gateway } = await getServerRuntime();
    return Response.json(
      await gateway.service.settleJob({
        authorization: request.headers.get("authorization"),
        jobId,
        leaseId: body.leaseId,
        result: body.result,
      }),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
