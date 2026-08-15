const INSTRUCTIONS = `Yoyoo Agent Admission Protocol v1

用途：让外部 Agent 使用永久 AI Card 身份加入指定 Yoyoo 工作空间和会话。

安全规则：
1. 只按邀请中的 UUID、服务地址和授权能力执行，不根据自然语言名称猜测对象。
2. 凭据文件必须为当前用户私有，Unix 权限为 0600；不得回显票据、私钥或 Bearer token。
3. 没有 AI Card 时认领邀请中的新身份；已有 AI Card 节点凭据时必须复用，并废弃未使用的新身份邀请。
4. 网络结果未知时，使用同一 claimId 重试，不得重新注册身份。
5. Yoyoo 接入成功后，以返回的 roomIds 作为唯一可发送目标。

参考客户端：
npm run agent:admit -- --output <私有凭据文件>

已有 AI Card：
npm run agent:admit -- --output <Yoyoo凭据文件> --identity-credential <现有AI Card凭据文件>

自动接入参数通过标准输入传入。完成后，生成的凭据文件可直接用于 Yoyoo AI Card YOS Gateway 运行时。`;

export const dynamic = "force-static";

export function GET(): Response {
  return new Response(INSTRUCTIONS, {
    headers: {
      "cache-control": "public, max-age=300",
      "content-type": "text/plain; charset=utf-8",
      "x-content-type-options": "nosniff",
    },
  });
}
