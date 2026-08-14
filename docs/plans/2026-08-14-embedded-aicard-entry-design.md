# Yoyoo 内置 AI Card 入口设计

## 目标

Yoyoo `/login` 在一个页面内完成产品介绍、已有 AI Card 登录和首次 AI Card 创建。用户始终停留在 Yoyoo 的视觉与交互语境中；AI Card 仍是唯一身份、密码、永久编号和授权权威，Yoyoo 不保存密码、不签发编号，也不创建备用本地身份。

## 页面结构

- 品牌区说明 Yoyoo 是“人与 AI 共享的协作空间”，不把登录页写成 AI Card 产品介绍页。
- 身份面板使用 `登录` / `创建 AI Card` 两段式切换。
- 登录字段：AI Card ID 或 `@Handle`、密码。
- 创建字段：昵称、`@Handle`、密码。
- 创建成功后在原面板显示永久编号和复制按钮，短暂停留后自动进入 Yoyoo。
- 删除“使用 AI Card 继续”的外跳按钮和“临时本地账号”入口。
- 页面只使用 Yoyoo 现有语义设计令牌、8px 圆角、光学毛玻璃和浅/深双主题，不增加独立背景图、渐变或装饰卡片。

## 架构与数据流

1. Yoyoo 创建带 PKCE、state、一次性幂等键和回调 Cookie 的授权事务，并以 JSON 返回 AI Card issuer 和标准授权请求。
2. 浏览器从 Yoyoo 页面直接向受信任的 AI Card origin 提交登录或注册请求。密码不会经过 Yoyoo API、数据库或日志。
3. AI Card 仅对精确配置的第一方产品 origin 开放携带凭据的 CORS；不允许通配 origin。
4. AI Card 验证凭据并在自己的 host-only Cookie 中建立会话，同时返回非秘密 CSRF token 和 Card 公共资料。
5. 浏览器使用该会话和 CSRF token 向 AI Card 提交当前 PKCE 授权请求；AI Card 签发一次性 authorization code。
6. 浏览器只导航回 Yoyoo callback。Yoyoo沿用现有 code exchange、pairwise Subject 映射、refresh token 加密保存和本地会话建立逻辑。

## 安全边界

- `Access-Control-Allow-Origin` 必须回显精确白名单 origin，并同时设置 `Vary: Origin` 与 `Access-Control-Allow-Credentials: true`。
- 生产白名单只允许 HTTPS；本地开发只允许 `localhost` 或 `127.0.0.1`。
- 登录、注册和授权继续使用现有限流、统一错误、CSRF、PKCE、state、一次性 code 和幂等保护。
- Yoyoo 页面不得读取或持久化 AI Card session token；只临时持有可公开的 Card 信息和 CSRF token。
- AI Card 不可用、CORS 配置缺失、授权结果不一致或 Card 无 Yoyoo 权限时明确失败，不降级到本地账号。

## 状态与可访问性

- `idle`：可切换登录/创建并填写表单。
- `loading`：禁用重复提交，显示当前动作。
- `success`：展示已确认身份或新签发 Card ID，再自动进入。
- `error`：在表单内显示可理解的错误并允许重试。
- 输入具备可见标签、正确 autocomplete、键盘焦点和移动端不溢出；动画遵守 `prefers-reduced-motion`。

## 不做什么

- 不合并 Yoyoo 与 AI Card 仓库或数据库。
- 不新增 Yoyoo 本地注册、密码找回或第二套身份。
- 不通过 iframe、反向代理页面或共享顶级域 Cookie 假装“内置”。
- 不在本阶段开放任意第三方 origin，也不改变 Agent 接入流程。
- 不在本地完整验收、生产备份和再次确认前发布。

## 验收

- 用户在 `/login` 不离开页面即可登录或创建 AI Card。
- 创建成功显示由 AI Card 返回的 `AI_` 永久编号，随后进入 Yoyoo。
- 浏览器历史中不出现可见的 `id.yoyooai.com` 登录/注册页面。
- Yoyoo 不接收密码；AI Card 拒绝未配置 origin、缺失 CSRF、错误 state 和重复 code。
- 浅色、深色、390px 手机和桌面视口均通过截图与无横向溢出检查。
