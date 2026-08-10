# 023 Feature - 通用 AI 附件访问

> 日期：2026-08-10  
> 范围：IM-1 第 3 阶段

## 背景

Yoyoo 是协作与授权平台，不应替 Agent 理解文件。平台需要提供厂商无关、可撤销、只面向目标 run 的资源协议。

## 关键决策

- Agent 请求只携带不可变附件描述符、校验摘要和 run-scoped 资源路径，不携带物理路径或永久 URL。
- 只有被正常路由选中的 Agent 获得短期 grant；每次读取仍复核身份、run、房间成员和凭据状态。
- Gateway 与 AI Card runtime 共用同一资源协议；不写 YOS 专属服务端文件通道。
- 不支持附件的适配器必须返回可见错误，禁止静默忽略。
- 当前 YOS Web Console 仅接收文本，因此参考桥只转换已授权、SHA-256 校验通过的小型 UTF-8 文本；单文件 256 KiB、总计 512 KiB。二进制仍明确拒绝。
- Agent 产出的文件复用同一 Attachment 模型，保留 producer 与 source run。

## 否掉的备选

- 将文件永久下载地址写入 prompt：无法及时撤权。
- 由 Yoyoo 解析 PDF/Office 后替 Agent 回答：混淆平台与 Agent 的职责。
- 对所有媒体做 Base64 文本桥：体积、质量和安全边界均不可控。

## 验证结果

- 合同、Gateway HTTP、资源仓库和 AI Card runtime 测试覆盖跨 Agent/run 拒绝、过期、撤权、幂等产物和无凭据泄露。
- 条件式真实验收 `YOS_GATEWAY_LIVE_TEST=1` 通过 2/2：真实 YOS 读取唯一标记文本并返回持久消息；撤销 Agent 凭据后下一次资源读取返回拒绝。
- 文本桥协议测试覆盖授权读取、摘要校验、二进制拒绝和不静默丢附件。

## 未包含

- YOS 对 PDF、Word、Excel、图片和压缩包的原生理解需要其上游文件接口；Yoyoo 仍可安全存储、预览或下载这些文件。
