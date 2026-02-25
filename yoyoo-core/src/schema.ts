import { z } from "zod";

export const InboundInputSchema = z.object({
  channel: z.string().min(1),
  senderId: z.string().min(1),
  senderName: z.string().optional(),
  conversationId: z.string().min(1),
  chatType: z.enum(["group", "direct", "p2p"]),
  text: z.string(),
});

export const NormalizedInboundSchema = z.object({
  channel: z.string().min(1),
  sender: z.object({
    id: z.string().min(1),
    name: z.string().optional(),
  }),
  conversation: z.object({
    id: z.string().min(1),
    chatType: z.enum(["group", "direct"]),
  }),
  message: z.object({
    text: z.string(),
  }),
});

export type InboundInput = z.infer<typeof InboundInputSchema>;
export type NormalizedInbound = z.infer<typeof NormalizedInboundSchema>;
