# 019 Feature AI Card 受控 Agent 身份

> 版本：Phase 6B1  
> 日期：2026-08-09  
> 状态：已实现并完成自动化自测；未独立验收或部署

## 背景

Phase 6A 只能把人类 AI Card 绑定到现有 Owner。Phase 6B1 增加最小的
“单人 + 多 AI”身份闭环：当前 Owner 选择自己控制的 AI Card，Yoyoo 将其
识别为稳定 Agent 成员，但暂不赋予运行节点会话或任务传输能力。

## 关键决策

- 授权请求显式携带 `principal_type=ai`；回调返回 human 时拒绝映射。
- AI Card 只展示当前已认证人类控制、控制关系未撤销且双方 Card 均 active
  的 AI 身份。提交时再次在事务内校验，防止选择后控制权变化。
- 本地唯一映射仍使用 `(issuer, client_id, pairwise subject)`，中文昵称、
  Handle 和公开 Card ID 都不作为 Yoyoo 主键。
- 映射和工作空间成员激活在同一事务内完成；重复授权复用同一 Agent。
- AI Card Agent 在目录显示为 `等待运行节点`，不伪造令牌状态，也不显示
  Gateway 的轮换和撤销按钮。
- `yya_` Gateway 保留并明确标记为“兼容接入”。

## 否掉的备选

- 直接把 AI Card ID 当本地 Principal ID：会耦合外部身份和平台资源主键。
- 授权成功后自动加入所有房间：房间成员是 Yoyoo 本地权限，不应由身份证明
  自动扩大。
- 立即删除 Gateway：Phase 6B1 没有交付节点会话和 job transport，会中断
  已有真实 AI。

## 影响范围

- AI Card 授权事务增加 human/agent 用途和预期身份类型。
- PrincipalRepository 增加 Agent 映射的工作空间成员原子激活与目录查询。
- `/settings/agents` 拆分“接入 AI Card”“连接我的身份”“兼容接入”。
- 未新增依赖、migration；首页、房间、消息和 Gateway 协议未改。

## 验证结果

- Yoyoo lint、typecheck、生产 build 通过。
- 单元与 UI：82/82；PostgreSQL/HTTP 集成：67/67，另有 6 项按环境跳过。
- 桌面与移动 Playwright：24/24。
- AI Card lint、typecheck、生产 build 通过；单元 58/58、集成 35/35、
  桌面与移动 Playwright 28/28。
- 已验证受控 AI 成功、外部/错误类型拒绝、重复映射幂等、成员关系幂等、
  暂停控制者拒绝，以及目录无旧令牌操作。

## 回退与后续

- 可隐藏 `接入 AI Card` 入口停止新授权；既有映射和历史归属不删除。
- Phase 6B2 继续实现节点密钥会话、job claim/result、撤销传播与兼容迁移。
- 真实硬件、独立安全验收和生产部署仍未完成。
