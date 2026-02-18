import { NextRequest, NextResponse } from "next/server";
import { getUserStore, setUserState } from "../_store";
import { PersistedConversationState } from "@/lib/chat-types";

export const runtime = "nodejs";

const badRequest = (message: string) =>
    NextResponse.json(
        {
            ok: false,
            error: message,
        },
        { status: 400 }
    );

export async function GET(request: NextRequest) {
    const userId = request.nextUrl.searchParams.get("userId");
    if (!userId) return badRequest("missing userId");
    const user = await getUserStore(userId);
    return NextResponse.json({
        ok: true,
        state: user.state,
    });
}

export async function PUT(request: NextRequest) {
    const body = (await request.json()) as {
        userId?: string;
        state?: Record<string, PersistedConversationState>;
    };
    if (!body.userId) return badRequest("missing userId");
    if (!body.state || typeof body.state !== "object") {
        return badRequest("invalid state");
    }
    await setUserState(body.userId, body.state);
    return NextResponse.json({
        ok: true,
    });
}
