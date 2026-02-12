# 项目核心资源清单（服务器连接与运维）

## 1. 服务器信息
- 公网 IP：115.191.36.128
- OS：Ubuntu 24.04 64bit，规格：4 vCPU / 4 GiB
- 角色：OpenClaw + MiniMax 网关（待安装）

## 2. SSH 连接方式
- 主通道（现用密钥）
  ```bash
  ssh -i "/Users/subai/A/A_subai/AIcode/Test/Yoyoo AI/Test0.10codex/中转/miyaodui.pem" \
      -o UserKnownHostsFile=/dev/null -o StrictHostKeyChecking=no \
      -o IdentitiesOnly=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=6 \
      root@115.191.36.128
  ```
- 端口转发访问网关（预留，网关启动后可用）
  ```bash
  ssh -i "/Users/subai/A/A_subai/AIcode/Test/Yoyoo AI/Test0.10codex/中转/miyaodui.pem" \
      -o UserKnownHostsFile=/dev/null -o StrictHostKeyChecking=no -o IdentitiesOnly=yes \
      -L 18789:127.0.0.1:18789 root@115.191.36.128
  # 浏览器: http://127.0.0.1:18789 ，token: 3b26090ac94b0e512af423b71e29c2de
  ```
- 已知 root 密码（仅应急）：SuBai123

## 3. 备用密钥计划（待创建）
- 生成：`ssh-keygen -t ed25519 -f ~/.ssh/claw_backup -N ''`
- 上传：将 `~/.ssh/claw_backup.pub` 追加到服务器 `/root/.ssh/authorized_keys`。
- 使用：
  ```bash
  ssh -i ~/.ssh/claw_backup -o UserKnownHostsFile=/dev/null -o StrictHostKeyChecking=no \
      -o IdentitiesOnly=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=6 \
      root@115.191.36.128
  ```

## 4. 防火墙/安全组
- 放行：22/tcp (SSH), 18789/tcp (OpenClaw 网关)
- 如使用 ufw：`ufw allow 22/tcp && ufw allow 18789/tcp && ufw enable`

## 5. OpenClaw + MiniMax 部署待办
- 状态：系统干净，尚未安装/启动 OpenClaw。
- 下一步（自动化脚本待执行）：
  1) 安装：`curl -fsSL https://molt.bot/install.sh | bash`
  2) 写入配置与模型：见 `project/install_minimax.sh`（将生成）。
  3) 启动并验证日志包含 `agent model: minimax/MiniMax-M2.1` 与 `listening on ws://127.0.0.1:18789`。

## 6. 重要提醒
- 不要提交私钥到版本库；`miyaodui.pem` 仅限本机使用。
- 如提示 "REMOTE HOST IDENTIFICATION HAS CHANGED"：`ssh-keygen -R 115.191.36.128` 再连接。
