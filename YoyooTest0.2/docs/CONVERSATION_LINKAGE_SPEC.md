# 会话联动规范（Conversation Linkage Spec）

## 1. 目标与范围
- 目标：左侧会话切换后，中间主内容区（对话区/任务中心/文件区）必须同步切换到对应会话数据。
- 范围：前端联动层（URL、状态、Mock 数据、渲染逻辑、验收）。
- 非范围：真实后端接口与鉴权（后续对接时按本规范映射）。

## 2. 路由协议（唯一真相）
- 会话通过 Query 参数驱动：`/?conv=<conversation-url>`
- 默认会话：`/?conv=/`
- 左侧会话点击统一使用：
  - `/?conv=/code-generation`
  - `/?conv=/photo-editing`
  - 等等
- 禁止再用页面 path（如 `/photo-editing`）作为主联动入口，避免主内容区与左栏高亮不一致。

## 3. 数据契约（每个会话一份 Bundle）
- 文件：`mocks/workspace.ts`
- 结构：
  - `messages`: 会话消息
  - `tasks`: 任务（支持 `parentTaskId`）
  - `artifacts`: 产物（code/image/audio/video/document/webpage）
  - `timeline`: 时间线事件
- 访问函数：
  - `getWorkspaceConversation(conv)`
  - 未命中时回退 `"/"`，保证页面不崩。

## 4. 组件职责
- 左侧会话列表：`components/LeftSidebar/ChatList/index.tsx`
  - 负责生成 `/?conv=...` 链接
  - 根据 `conv` 判断 active 态
  - 会话状态（重命名/置顶/删除）存入 `localStorage`
- 工作台页面：`templates/WorkspacePage/index.tsx`
  - 通过 `useSearchParams` 读取 `conv`
  - 按 `conv` 拉取 bundle 并渲染三块区域

## 5. 新增一个会话的标准步骤
1. 在 `mocks/workspace.ts` 新增该会话 key（如 `"/sales-report"`）及完整 bundle。  
2. 在左侧会话数据源中加入对应 `url`（`chatList` 或 `chatHistory`）。  
3. 验证点击后主区内容、左栏高亮、刷新保留是否正确。  
4. 确认未配置会话时可回退 `"/"`。

## 6. 稳定性要求（防水合错误）
- 所有易漂移文本（空格、快捷键、动态文案）避免 SSR/CSR 不一致。
- 对不可避免节点使用 `suppressHydrationWarning`。
- 禁止在首屏直接依赖不稳定值（如 `new Date()`）；改为挂载后初始化。

## 7. 验收清单
- 自动化：
  - `npm run lint`
  - `npm run smoke:routes`
  - `npm run smoke:css`
- 手工：
  - 切换 3+ 会话，主区内容均变化
  - 刷新后会话状态（置顶/改名/删除）保留
  - 无 hydration 报错

