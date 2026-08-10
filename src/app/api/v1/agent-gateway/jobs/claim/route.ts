import { z } from "zod";

import { errorResponse } from "@/server/http-response";
import { getServerRuntime } from "@/server/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const claimSchema = z
  .object({ leaseMs: z.number().int().min(1_000).max(120_000).optional() })
  .strict();

export async function POST(request: Request): Promise<Response> {
  try {
    const body = claimSchema.parse(await request.json());
    const { gateway } = await getServerRuntime();
    const job = await gateway.service.claimJob({
      authorization: request.headers.get("authorization"),
      leaseMs: body.leaseMs,
    });
    return job ? Response.json({ job }) : new Response(null, { status: 204 });
  } catch (error) {
    return errorResponse(error);
  }
}
