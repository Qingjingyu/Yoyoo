import { NextRequest, NextResponse } from "next/server";
import {
    appendUserMessage,
    getUserMessages,
    removeUserMessages,
} from "../_store";
import { PersistedConversationMessage } from "@/lib/chat-types";

export const runtime = "nodejs";

const badRequest = (message: string) =>
    NextResponse.json(
        {
            ok: false,
            error: message,
        },
        { status: 400 }
    );

const parseConversationId = (request: NextRequest) =>
    request.nextUrl.searchParams.get("conversationId") ??
    request.nextUrl.searchParams.get("conv");

export async function GET(request: NextRequest) {
    const userId = request.nextUrl.searchParams.get("userId");
    const conversationId = parseConversationId(request);
    if (!userId) return badRequest("missing userId");
    if (!conversationId) return badRequest("missing conversationId");
    const messages = await getUserMessages(userId, conversationId);
    return NextResponse.json({
        ok: true,
        messages,
    });
}

export async function POST(request: NextRequest) {
    const body = (await request.json()) as {
        userId?: string;
        conversationId?: string;
        conv?: string;
        dedupeKey?: string;
        message?: PersistedConversationMessage;
    };
    const conversationId = body.conversationId ?? body.conv;
    if (!body.userId) return badRequest("missing userId");
    if (!conversationId) return badRequest("missing conversationId");
    if (!body.message || typeof body.message !== "object") {
        return badRequest("missing message");
    }

    const message = await appendUserMessage(
        body.userId,
        conversationId,
        body.message,
        body.dedupeKey
    );
    return NextResponse.json({
        ok: true,
        message,
    });
}

export async function DELETE(request: NextRequest) {
    const userId = request.nextUrl.searchParams.get("userId");
    const conversationId = parseConversationId(request);
    if (!userId) return badRequest("missing userId");
    if (!conversationId) return badRequest("missing conversationId");
    await removeUserMessages(userId, conversationId);
    return NextResponse.json({
        ok: true,
    });
}
