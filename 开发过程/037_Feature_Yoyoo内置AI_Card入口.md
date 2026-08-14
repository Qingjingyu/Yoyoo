# 037 Feature - Yoyoo 内置 AI Card 入口

## 背景

旧登录页把 AI Card 表现成要跳转的外部系统，并保留临时本地账号，用户无法理解 AI Card 是 Yoyoo 内置的统一身份。新入口需要在一页内说明产品、登录已有 Card 或创建新 Card。

## 关键决策

- 登录页使用 Yoyoo 现有双主题、毛玻璃 Token、8px 控件圆角和克制的单面板结构。
- “登录 AI Card”和“创建 AI Card”是同级分段选项；删除外跳主按钮和临时本地账号入口。
- Yoyoo 只生成并密封 PKCE 事务，向浏览器返回公开请求；`code_verifier` 始终留在 HttpOnly 加密 Cookie。
- 浏览器把密码直送 AI Card 白名单 Origin，再以 AI Card 会话和 CSRF Token 完成授权。
- 只接受回到当前 Yoyoo Origin 的固定 callback 路径和原始 OAuth state，拒绝外部重定向或事务篡改。
- 创建成功直接展示永久 `AI_######` 编号，然后继续进入 Yoyoo，不再要求二次绑定。

## 否掉的备选

- 继续跳往 `id.yoyooai.com`：产品体验割裂，不符合“内置账号体系”的认知。
- Yoyoo 代理密码：会把统一身份凭据暴露给业务产品，扩大泄露与审计范围。
- 继续保留本地账号：会恢复第二套身份，破坏 AI Card 权威发号和跨产品复用。

## 测试结果

- JSON PKCE 起点单测 2/2 通过，响应不包含 verifier。
- 登录页 UI 单测 8/8 通过，覆盖 SSR 关闭、登录、创建、业务错误、网络错误、回调来源与 state 拦截和密码边界。
- Yoyoo 全量测试 39 个文件、193 个测试通过。
- `npm run typecheck`、`npm run lint` 与 `npm run build` 通过。
- Playwright 实测浅色桌面、深色桌面、390px 移动端创建页和身份服务离线错误态，页面无横向溢出，失败后可重试。
- PostgreSQL 集成测试和双服务真实注册登录闭环因本机 Docker 守护进程不可用尚未执行；未据此宣称生产可发布。

## 影响范围

只修改 Yoyoo 人类登录入口和 AI Card 授权起点。Agent 接入、房间、消息、附件、首页和现有回调换 Token 逻辑不变。
