#!/usr/bin/env node
/* eslint-disable no-console */

const FRONTEND_BASE = (process.env.YOYOO_WEB_BASE || "http://127.0.0.1:3000").replace(/\/+$/, "");
const BACKEND_BASE = (process.env.YOYOO_BACKEND_BASE || "http://127.0.0.1:18000").replace(/\/+$/, "");

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const nowId = () => `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

async function getJson(url) {
  const resp = await fetch(url, { cache: "no-store" });
  if (!resp.ok) throw new Error(`GET ${url} failed: HTTP ${resp.status}`);
  return resp.json();
}

async function postJson(url, body) {
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`POST ${url} failed: HTTP ${resp.status} ${text}`.trim());
  }
  return resp.json();
}

async function postStream({ userId, conversationId, prompt }) {
  const resp = await fetch(`${FRONTEND_BASE}/api/chat/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId, conversationId, prompt }),
  });
  if (!resp.ok) throw new Error(`POST /api/chat/stream failed: HTTP ${resp.status}`);
  return resp.text();
}

function assertOrThrow(condition, message) {
  if (!condition) throw new Error(message);
}

function logPass(title, detail = "") {
  console.log(`✅ ${title}${detail ? ` - ${detail}` : ""}`);
}

async function pollUntil(check, { timeoutMs = 20000, intervalMs = 1200, onTimeout = "poll timeout" } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const value = await check();
    if (value) return value;
    await wait(intervalMs);
  }
  throw new Error(onTimeout);
}

async function run() {
  const runId = nowId();
  const userId = `u_accept_${runId}`;
  const convA = `conv_a_${runId}`;
  const convB = `conv_b_${runId}`;

  // Health checks
  const health = await getJson(`${BACKEND_BASE}/healthz`);
  assertOrThrow(health?.ok === true, "backend /healthz not ok");
  const webStatus = await fetch(`${FRONTEND_BASE}/`, { cache: "no-store" });
  assertOrThrow(webStatus.ok, "frontend / not reachable");
  logPass("环境检查", "前后端服务在线");

  // S1 普通对话
  const s1 = await postStream({
    userId,
    conversationId: convA,
    prompt: "你好",
  });
  assertOrThrow(/我在|目标|推进/.test(s1), "S1 普通对话未返回 CEO 正常回复");
  logPass("S1 普通对话", "CEO 正常响应");

  // S2 任务触发（需确认）
  const s2 = await postStream({
    userId,
    conversationId: convA,
    prompt: "帮我开发一个企业官网，包含首页、产品页、联系我们",
  });
  assertOrThrow(s2.includes("确认执行"), "S2 未进入确认执行流程");
  logPass("S2 任务触发", "进入确认执行流程");

  // S3 长任务进度（确认执行 -> task_id -> 任务中心可见）
  const s3 = await postStream({
    userId,
    conversationId: convA,
    prompt: "确认执行",
  });
  const taskIdMatch = s3.match(/task_\d{14}_[a-z0-9]+/i);
  assertOrThrow(Boolean(taskIdMatch?.[0]), "S3 未返回 task_id");
  const taskId = taskIdMatch[0];

  const taskCenter = await pollUntil(
    async () => {
      const data = await getJson(
        `${FRONTEND_BASE}/api/chat/tasks?userId=${encodeURIComponent(userId)}&conversationId=${encodeURIComponent(
          convA
        )}`
      );
      const hit = (data.tasks || []).find((item) => item.id === taskId);
      if (!hit) return null;
      return data;
    },
    {
      onTimeout: "S3 任务中心未出现新任务",
    }
  );
  assertOrThrow(Array.isArray(taskCenter.timeline) && taskCenter.timeline.length > 0, "S3 无任务时间线");
  logPass("S3 长任务进度", `任务 ${taskId} 已进入任务中心并有时间线`);

  // S4 失败重试（消息幂等去重，重复提交只写入一次）
  const dedupeKey = `retry_${runId}`;
  const msgId = `msg_${runId}`;
  const payload = {
    userId,
    conversationId: convA,
    dedupeKey,
    message: {
      id: msgId,
      role: "user",
      content: "失败重试-幂等校验",
      createdAt: "10:00",
      status: "sent",
    },
  };
  await postJson(`${FRONTEND_BASE}/api/chat/messages`, payload);
  await postJson(`${FRONTEND_BASE}/api/chat/messages`, payload);
  const afterRetry = await getJson(
    `${FRONTEND_BASE}/api/chat/messages?userId=${encodeURIComponent(userId)}&conversationId=${encodeURIComponent(convA)}`
  );
  const sameIdCount = (afterRetry.messages || []).filter((m) => m.id === msgId).length;
  assertOrThrow(sameIdCount === 1, `S4 幂等失败，重复消息写入 ${sameIdCount} 次`);
  logPass("S4 失败重试", "重复提交已去重（幂等）");

  // S5 刷新后历史仍在（服务端消息历史可读）
  const refreshMsgId = `msg_refresh_${runId}`;
  await postJson(`${FRONTEND_BASE}/api/chat/messages`, {
    userId,
    conversationId: convA,
    dedupeKey: `refresh_${runId}`,
    message: {
      id: refreshMsgId,
      role: "assistant",
      content: "这是刷新后仍可见的历史消息",
      createdAt: "10:01",
      status: "sent",
    },
  });
  const afterRefresh = await getJson(
    `${FRONTEND_BASE}/api/chat/messages?userId=${encodeURIComponent(userId)}&conversationId=${encodeURIComponent(convA)}`
  );
  assertOrThrow(
    (afterRefresh.messages || []).some((m) => m.id === refreshMsgId),
    "S5 历史消息未持久化"
  );
  logPass("S5 刷新历史", "历史消息持久化有效");

  // S6 多会话切换（会话隔离）
  const convBMsgId = `msg_b_${runId}`;
  await postJson(`${FRONTEND_BASE}/api/chat/messages`, {
    userId,
    conversationId: convB,
    dedupeKey: `convb_${runId}`,
    message: {
      id: convBMsgId,
      role: "user",
      content: "这是会话B的消息",
      createdAt: "10:02",
      status: "sent",
    },
  });
  const convAData = await getJson(
    `${FRONTEND_BASE}/api/chat/messages?userId=${encodeURIComponent(userId)}&conversationId=${encodeURIComponent(convA)}`
  );
  const convBData = await getJson(
    `${FRONTEND_BASE}/api/chat/messages?userId=${encodeURIComponent(userId)}&conversationId=${encodeURIComponent(convB)}`
  );
  assertOrThrow(
    !(convAData.messages || []).some((m) => m.id === convBMsgId),
    "S6 会话污染：B 消息出现在 A"
  );
  assertOrThrow(
    (convBData.messages || []).some((m) => m.id === convBMsgId),
    "S6 会话隔离失败：B 消息未写入 B"
  );
  logPass("S6 多会话切换", "会话数据隔离正常");

  console.log("\n🎉 验收完成：6/6 通过");
  console.log(`run_id=${runId}`);
}

run().catch((error) => {
  console.error(`\n❌ 验收失败: ${(error && error.message) || error}`);
  process.exitCode = 1;
});
