# dsh-proxy

## 把你的 DeepSeek Harness（DSH）端口代理到 `http://<本机IP>:3301`，并额外施加安全协议，让你内网可以任何时候访问 DSH（包括手机）。

> ⚠️ **仅适用于 DSH 1.1。** DeepSeek Harness **1.2** 加入了**本地 token 验证**，会破坏这种反向代理方式（代理无法再透传访问界面）。本项目面向 DSH **1.1**。若你用的是 1.2+，需要别的访问方式。

[English](./README.md) · **中文**

在 [DSH](https://github.com/deepseek-ai/dsh) Web GUI 前面的**带密码反向代理**（HTTP + WebSocket）。

DSH 保持绑定在 `127.0.0.1`（仅回环，安全）。本代理绑定 `0.0.0.0`，让局域网内的手机能通过密码访问它。

> **零依赖** —— 纯 Node 内置模块。跨平台（macOS / Linux / Windows × x86 / ARM）。

## 给 agent 看（TL;DR）

DSH 前面的带密码反向代理。DSH 保持回环；本代理绑定 `0.0.0.0:3301` 并转发 HTTP + WebSocket 给它。认证是签名 cookie（30 天会话）、可选 HTTPS、带速率限制。运行：`DSH_PROXY_PASS=<密码> node lib/cli.js`。macOS 停止：`launchctl bootout gui/$(id -u)/com.dsh.lan-proxy`。详见下文。

## 为什么

- **DSH 保持回环** —— 从不直接暴露。
- **Cookie 会话认证** —— 避免 Basic-Auth 反复弹窗（会破坏 WebSocket/SSE 应用）。首次请求通过 Basic Auth，之后签发签名会话 cookie；后续请求（含 WebSocket 升级）凭 cookie 通过。会话 cookie 持久 **30 天**（Max-Age），浏览器重启不用重新认证。代理把它的 cookie **追加**到 DSH 自己的 Set-Cookie（如语言偏好）后面，而不是覆盖，所以 DSH 设置能持久。
- **HTTPS（可选）** —— 自签证书加密密码/会话传输。
- **速率限制** —— 登录失败过多会锁定 IP。
- **零依赖** —— 纯 Node 内置模块。
- **3301!**
  
## 运行

```bash
DSH_PROXY_PASS=你的密码 node lib/cli.js
# 或安装 bin 后
DSH_PROXY_PASS=你的密码 dsh-proxy
```

然后从局域网任意设备打开 `http://<本机IP>:3301`。

### 环境变量

| 变量 | 默认 | 含义 |
|---|---|---|
| `DSH_PROXY_PORT` | `3301` | 监听端口 |
| `DSH_PROXY_HOST` | `0.0.0.0` | 监听地址 |
| `DSH_PROXY_USER` | `dsh` | Basic Auth 用户名 |
| `DSH_PROXY_PASS` | *(必填)* | Basic Auth 密码 |
| `DSH_UPSTREAM` | `127.0.0.1:3080` | 上游 DSH 地址 |
| `DSH_PROXY_SECRET_FILE` | `/tmp/dsh-proxy-secret` | 会话签名密钥文件 |
| `DSH_PROXY_CERT` | `/tmp/dsh-proxy-cert.pem` | HTTPS 证书（存在则启用 TLS） |
| `DSH_PROXY_KEY` | `/tmp/dsh-proxy-key.pem` | HTTPS 私钥 |

## HTTPS（推荐）

生成一次自签证书，代理即走 HTTPS：

```bash
openssl req -x509 -newkey rsa:2048 -nodes \
  -keyout /tmp/dsh-proxy-key.pem -out /tmp/dsh-proxy-cert.pem \
  -days 365 -subj "/CN=dsh-proxy"
```

浏览器会提示一次自签证书警告 —— 接受一次即可。之后密码和会话在网络上加密传输。

## macOS launchd（开机自启）

见 `com.dsh.lan-proxy.plist`（模板）。加载：

```bash
launchctl bootstrap gui/$(id -u) /path/to/com.dsh.lan-proxy.plist
```

### 手动停止 / 启动

```bash
# 停止（关掉代理）
launchctl bootout gui/$(id -u)/com.dsh.lan-proxy

# 重新启动
launchctl bootstrap gui/$(id -u) /Users/maxgray/Library/LaunchAgents/com.dsh.lan-proxy.plist

# 查看状态
launchctl list | grep dsh.lan-proxy
```

## 安全说明与风险

**已加固：**
- DSH 保持回环（从不直接暴露）。
- 认证是 HMAC-SHA256 签名 cookie + 常量时间比较 + `HttpOnly` —— 防篡改、抗时序攻击。
- 速率限制（5 次失败 → 锁 5 分钟）默认开启。
- HTTPS（启用时）加密密码和会话传输。

**已知风险 / 需注意：**
- **弱 / 明文密码** —— 默认示例用短数字密码，且明文存在 launchd plist 里。能读 plist（或进程环境）的人能看到密码。**请用强随机密码**，并尽量别明文存配置。
- **自签证书** —— 浏览器提示一次警告。加密是真实的（RSA 2048），但证书不是受信任 CA 签发，首次连接若用户盲目接受而不核对指纹，理论上可能被中间人攻击。
- **局域网暴露** —— 代理绑定 `0.0.0.0`，局域网内任何人都能尝试访问，密码是唯一门禁。在不可信网络上这不够。
- **无 IP 白名单** —— 仅密码访问。如需更严控制，放到 VPN（如 Tailscale）后面或加 IP 白名单。

**推荐部署：**
1. 用**强密码**（≥12 位，混合字符）。
2. **启用 HTTPS**（可信局域网用自签即可）。
3. 局域网不可信时放到 **VPN**（Tailscale/WireGuard）后面。
4. 密码别明文存配置（用 0600 权限的密钥文件，或从安全来源读环境变量）。

## 参与贡献

欢迎贡献！有帮助的方向：

- **IP 白名单** / 每用户访问控制。
- **OAuth2 / SSO** 登录（用已有账号替代密码）。
- 用 mkcert 或 Let's Encrypt 做**正式 TLS**。
- **暴力破解加固**（指数退避、持久锁定状态）。
- **测试** 和 CI。
- 更好的文档 / 翻译。

开 issue 或 PR —— 见 [GitHub 仓库](https://github.com/)。

## 鸣谢

本项目由 [Aztech Labs](https://github.com/Aztech-Lab) 使用 DeepSeek Harness（Deepseek-V4-Flash）完成。

<img src="lib/3301.PNG" width="50%" alt="3301">

## 许可证

MIT
