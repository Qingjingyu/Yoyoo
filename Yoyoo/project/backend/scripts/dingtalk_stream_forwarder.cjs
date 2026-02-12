#!/usr/bin/env node
/* eslint-disable no-console */

const { DWClient, TOPIC_ROBOT, TOPIC_CARD, TOPIC_AI_GRAPH_API } = require("dingtalk-stream");

const clientId = process.env.DINGTALK_CLIENT_ID;
const clientSecret = process.env.DINGTALK_CLIENT_SECRET;
const eventsUrl =
  process.env.YOYOO_DINGTALK_EVENTS_URL || "http://127.0.0.1:18000/api/v1/dingtalk/events";
const extraTopics = String(process.env.YOYOO_DINGTALK_EXTRA_TOPICS || "")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);
const messageCacheTtlMs = Number(process.env.YOYOO_DINGTALK_MSG_CACHE_TTL_MS || "300000");
const seenMessageIds = new Map();
const streamDebug = String(process.env.YOYOO_DINGTALK_STREAM_DEBUG || "0").toLowerCase();
const debugEnabled = ["1", "true", "yes", "on"].includes(streamDebug);

if (!clientId || !clientSecret) {
  console.error("[dingtalk-forwarder] missing DINGTALK_CLIENT_ID or DINGTALK_CLIENT_SECRET");
  process.exit(1);
}

async function postToYoyoo(payload) {
  const response = await fetch(eventsUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`yoyoo_http_${response.status}:${body.slice(0, 280)}`);
  }
  return body;
}

function previewPayload(raw) {
  if (typeof raw !== "string") return "";
  return raw.length <= 240 ? raw : `${raw.slice(0, 240)}...`;
}

function shouldProcessMessage(messageId) {
  if (!messageId) return true;
  const now = Date.now();
  for (const [key, ts] of seenMessageIds.entries()) {
    if (now - ts > messageCacheTtlMs) seenMessageIds.delete(key);
  }
  if (seenMessageIds.has(messageId)) return false;
  seenMessageIds.set(messageId, now);
  return true;
}

function parsePayload(rawData) {
  if (rawData && typeof rawData === "object") return rawData;
  if (typeof rawData === "string") {
    return JSON.parse(rawData);
  }
  return {};
}

async function forwardEnvelope(source, upstreamTopic, messageId, rawData) {
  if (!shouldProcessMessage(messageId)) {
    console.log(
      `[dingtalk-forwarder] duplicate ignored source=${source} topic=${upstreamTopic} messageId=${messageId}`
    );
    return;
  }
  console.log(
    `[dingtalk-forwarder] envelope source=${source} topic=${upstreamTopic} messageId=${messageId || "none"}`
  );

  let payload;
  try {
    payload = parsePayload(rawData);
  } catch (error) {
    console.error("[dingtalk-forwarder] invalid payload:", error?.message || error);
    console.error("[dingtalk-forwarder] payload preview:", previewPayload(rawData || ""));
    return;
  }

  try {
    await postToYoyoo(payload);
    const eventId = payload?.eventId || payload?.msgId || messageId || "unknown";
    console.log(`[dingtalk-forwarder] forwarded event=${eventId}`);
  } catch (error) {
    console.error("[dingtalk-forwarder] forward failed:", error?.message || error);
  }
}

function ackCallbackMessage(client, messageId) {
  if (!messageId) {
    return;
  }
  try {
    client.socketCallBackResponse(messageId, { success: true });
  } catch (error) {
    console.error("[dingtalk-forwarder] ack error:", error?.message || error);
  }
}

async function handleCallbackEnvelope(client, upstreamTopic, messageId, rawData) {
  ackCallbackMessage(client, messageId);
  await forwardEnvelope("callback", upstreamTopic, messageId, rawData);
}

function registerTopic(client, topic) {
  // Register subscriptions only. CALLBACK handling is centralized in onCallback.
  client.registerCallbackListener(topic, () => {});
}

async function main() {
  const client = new DWClient({
    clientId,
    clientSecret,
    debug: debugEnabled,
    keepAlive: true,
  });

  const originalOnCallback = client.onCallback.bind(client);
  client.onCallback = (message) => {
    const upstreamTopic = message?.headers?.topic || "unknown";
    const messageId = message?.headers?.messageId || "";
    void handleCallbackEnvelope(client, upstreamTopic, messageId, message?.data || "{}");
    try {
      originalOnCallback(message);
    } catch (error) {
      console.error("[dingtalk-forwarder] callback emit error:", error?.message || error);
    }
  };

  client.registerAllEventListener((event) => {
    const topic = event?.headers?.topic || "unknown";
    const messageId = event?.headers?.messageId || "";
    console.log(`[dingtalk-forwarder] stream-event topic=${topic} messageId=${messageId || "none"}`);
    if (
      topic === TOPIC_ROBOT ||
      topic === TOPIC_CARD ||
      topic === TOPIC_AI_GRAPH_API ||
      topic.includes("/im/bot/messages/get") ||
      topic.includes("/card/instances/callback") ||
      topic.includes("/graph/api/invoke")
    ) {
      void forwardEnvelope("event", topic, messageId, event?.data || "{}");
    }
    return { status: "SUCCESS" };
  });

  const topics = Array.from(
    new Set(["*", TOPIC_ROBOT, TOPIC_CARD, TOPIC_AI_GRAPH_API, ...extraTopics])
  );
  topics.forEach((topic) => registerTopic(client, topic));

  console.log(
    `[dingtalk-forwarder] starting appKey=${clientId} debug=${debugEnabled} events_url=${eventsUrl} topics=${topics.join(",")}`
  );
  await client.connect();
  console.log("[dingtalk-forwarder] connected");
}

main().catch((error) => {
  console.error("[dingtalk-forwarder] fatal:", error?.stack || error?.message || error);
  process.exit(1);
});
