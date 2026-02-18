# Yoyoo 前端模块资产库（V0.1）

> 目标：把可复用模块沉淀成“组件库 + 调用清单”，后续按任务编排调用，而不是临时拼 UI。

## 1. 当前已具备模块（可直接调用）

### 1.1 会话与布局
- 三栏工作台（左导航 / 中会话 / 右历史）：`components/Layout`
- 聊天列表与分组、新建列表弹窗：`components/LeftSidebar/ChatList`、`components/AddChatList`
- 右侧历史与归档交互：`components/RightSidebar`

### 1.2 消息与输入
- 问题气泡、回答气泡：`components/Question`、`components/Answer`
- 输入框、附件入口、语音按钮占位：`components/Message`、`components/Message/AddFile`
- 分享、复制、重新生成等动作：`components/Chat/Actions`、`components/Answer/Actions`

### 1.3 任务产物展示模块
- 代码块（高亮 + 复制）：`components/Code`
- 图片结果（预览/导出/调整）：`components/Photo`、`components/Export`、`components/Adjust`
- 视频结果（封面 + 播放入口）：`components/Video`、`components/Video/View`
- 音频结果（音频条 + 参数 + 导出）：`components/Audio`、`components/AudioPlayer`
- 文档卡片：`components/Question/Document`
- 表格反馈（教育测评）：`components/Feedback/Assessment`
- 搜索结果卡片（外链跳转）：`components/Search/Item`
- 社媒流程卡（帖子 / 排期 / 结果）：`components/SocialsPost`、`components/SchedulePost`、`components/ScheduleResult`

### 1.4 账号与管理页（UI 已有）
- 登录/注册/忘记密码：`templates/SignInPage/*`
- 设置中心（团队、会话、应用、通知等）：`components/Settings/*`
- 应用中心（技能广场形态）：`templates/ApplicationsPage/*`

## 2. 缺失模块（优先补齐）
- 通用任务卡：负责人、状态、ETA、优先级、依赖关系
- 通用任务时间线：阶段里程碑、事件日志、产物清单
- 网页内嵌预览块（不仅是跳转链接）
- 多任务看板（并发任务视图）
- 产物仓（版本、对比、回滚、引用关系）
- 后端真实打通（当前大部分为 mock 与前端本地状态）

## 2.1 当前开发状态（2026-02）
- 已新增：`TaskCard`（`components/TaskCard`）
- 已新增：`TaskTimeline`（`components/TaskTimeline`）
- 已新增：`ArtifactCard`（`components/ArtifactCard`）
- 已新增：`WebPreview`（`components/WebPreview`）
- 演示页：`/module-library`（`templates/ModuleLibraryPage`）

## 2.2 结构冻结（V1）
- 页面结构固定为三层：`对话区 -> 任务中心 -> 文件/搜索区`
- 对话区：只负责人与 Yoyoo 沟通，不直接承担任务管理
- 任务中心：负责主任务、子任务、状态推进与时间线
- 文件/搜索区：负责产物沉淀、检索与后续复用
- 新首页骨架：`templates/WorkspacePage`（路由 `/`）
- 会话联动标准：见 `docs/CONVERSATION_LINKAGE_SPEC.md`

## 3. 统一设计规范（新增模块必须遵守）
- 色彩、字号、圆角、阴影：严格沿用 `tailwind.config.ts`
- 组件交互基元：优先复用 `Modal`、`Select`、`Actions`、`Notify`
- 响应式断点：沿用 `2xl/xl/lg/md/sm`，不新增并行断点体系
- 语义与文案：统一走 `lib/i18n.ts`，禁止硬编码中文/英文

## 4. 调用策略（团队执行规则）
- 小需求：直接拼现有模块，不新增组件
- 中需求：允许新增“业务组合组件”，不改设计基元
- 大需求：先补“通用模块”再做业务页，避免一次性写死

## 5. 开发优先级建议
- P0：先文档化（本文件）+ 统一命名与分类
- P1：补通用任务卡、时间线、网页预览块
- P2：补多任务看板与产物仓
- P3：再做 Yoyoo 后端对接（真实任务/记忆/归档）

> 建议结论：**先文档化再按需补模块**，不要一次性全开发。这样风险最小、复用率最高、后续接后端最稳。
