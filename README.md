# dsh-proxy

Password-protected **reverse proxy** (HTTP + WebSocket) in front of a
[DSH](https://github.com/deepseek-ai/dsh) Web GUI.

DSH stays bound to `127.0.0.1` (loopback only, safe). This proxy binds to
`0.0.0.0` so a phone on the LAN can reach it — behind a password.

> **Zero dependencies** — pure Node built-ins. Cross-platform (macOS / Linux /
> Windows × x86 / ARM).

## Why

- **DSH stays loopback-only** — never exposed directly.
- **Cookie-session auth** — avoids the repeated Basic-Auth re-prompt that breaks
  WebSocket/SSE-heavy apps. First request passes Basic Auth, then a signed
  session cookie is issued; later requests (incl. WebSocket upgrades) are
  accepted by the cookie. The session cookie persists **30 days** (Max-Age), so
  you don't re-authenticate on every browser restart. The proxy **appends** its
  cookie to DSH's own Set-Cookie (e.g. language prefs) instead of overwriting
  it, so DSH settings persist.
- **HTTPS (optional)** — a self-signed cert encrypts the password/session on
  the wire.
- **Rate limiting** — locks out an IP after too many failed logins.
- **Zero dependencies** — pure Node built-ins.

## Run

```bash
DSH_PROXY_PASS=yourpassword node lib/cli.js
# or after installing the bin
DSH_PROXY_PASS=yourpassword dsh-proxy
```

Then open `http://<this-machine-ip>:3301` from any device on the LAN.

### Env

| var | default | meaning |
|---|---|---|
| `DSH_PROXY_PORT` | `3301` | listen port |
| `DSH_PROXY_HOST` | `0.0.0.0` | listen host |
| `DSH_PROXY_USER` | `dsh` | basic-auth username |
| `DSH_PROXY_PASS` | *(required)* | basic-auth password |
| `DSH_UPSTREAM` | `127.0.0.1:3080` | upstream DSH host:port |
| `DSH_PROXY_SECRET_FILE` | `/tmp/dsh-proxy-secret` | session-signing secret file |
| `DSH_PROXY_CERT` | `/tmp/dsh-proxy-cert.pem` | HTTPS cert (enables TLS if present) |
| `DSH_PROXY_KEY` | `/tmp/dsh-proxy-key.pem` | HTTPS key |

## HTTPS (recommended)

Generate a self-signed cert once, then the proxy serves HTTPS:

```bash
openssl req -x509 -newkey rsa:2048 -nodes \
  -keyout /tmp/dsh-proxy-key.pem -out /tmp/dsh-proxy-cert.pem \
  -days 365 -subj "/CN=dsh-proxy"
```

Browsers will show a one-time self-signed warning — accept it once. The
password and session are then encrypted on the wire.

## macOS launchd (auto-start)

See `com.dsh.lan-proxy.plist` (template). Load it with:

```bash
launchctl bootstrap gui/$(id -u) /path/to/com.dsh.lan-proxy.plist
```

### Manual stop / start

```bash
# stop (turn the proxy off)
launchctl bootout gui/$(id -u)/com.dsh.lan-proxy

# start again
launchctl bootstrap gui/$(id -u) /Users/maxgray/Library/LaunchAgents/com.dsh.lan-proxy.plist

# check status
launchctl list | grep dsh.lan-proxy
```

## Security notes & risks

**What's hardened:**
- DSH stays loopback-only (never exposed directly).
- Auth is a HMAC-SHA256 signed cookie with constant-time comparison and
  `HttpOnly` — tamper-proof and resistant to timing attacks.
- Rate limiting (5 failures → 5 min lockout) is on by default.
- HTTPS (when enabled) encrypts the password and session on the wire.

**Known risks / things to be aware of:**
- **Weak / plaintext password** — the default example uses a short numeric
  password stored in plaintext in the launchd plist. Anyone who can read the
  plist (or the process env) sees it. **Use a strong, random password** and
  keep it out of plaintext config where possible.
- **Self-signed cert** — browsers show a one-time warning. The encryption is
  real (RSA 2048), but the cert isn't from a trusted CA, so a MITM on first
  connect is theoretically possible if the user blindly accepts without
  verifying the fingerprint.
- **LAN exposure** — the proxy binds to `0.0.0.0`; anyone on the LAN can
  attempt access. The password is the only gate. On an untrusted network this
  is not sufficient.
- **No per-IP allowlist** — access is password-only. If you need stricter
  control, put this behind a VPN (e.g. Tailscale) or add an IP allowlist.

**Recommended deployment:**
1. Use a **strong password** (≥12 chars, mixed).
2. **Enable HTTPS** (self-signed is fine for a trusted LAN).
3. Put it behind a **VPN** (Tailscale/WireGuard) if the LAN isn't trusted.
4. Keep the password out of plaintext config (use a secret file with 0600
   perms, or an env from a secure source).

## Contributing

Contributions are welcome! Ideas that would help:

- **IP allowlist** / per-user access control.
- **OAuth2 / SSO** login (replace the password with an existing account).
- **Proper TLS** via mkcert or Let's Encrypt.
- **Brute-force hardening** (exponential backoff, persistent lockout state).
- **Tests** and CI.
- Better docs / translations.

Open an issue or PR — see the [GitHub repo](https://github.com/).

## License

MIT
