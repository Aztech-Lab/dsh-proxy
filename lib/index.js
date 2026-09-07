/**
 * dsh-proxy — password-protected reverse proxy in front of a DSH Web GUI.
 *
 * DSH stays bound to 127.0.0.1 (loopback only, safe). This proxy binds to
 * 0.0.0.0 so a phone on the LAN can reach it. Auth is cookie-based to avoid
 * the repeated Basic-Auth re-prompt that breaks WebSocket/SSE-heavy apps:
 *   - First request must pass HTTP Basic Auth; on success the proxy issues a
 *     signed session cookie.
 *   - Every later request (including WebSocket upgrades, which carry cookies)
 *     is accepted by the cookie, so the browser never re-prompts.
 * It forwards HTTP and WebSocket to the loopback DSH server, rewriting the Host
 * header back to loopback and stripping the Origin header so DSH's browser-trust
 * fence accepts the forwarded traffic.
 *
 * Security: optional HTTPS (self-signed cert) encrypts the password/session on
 * the wire; rate limiting locks out an IP after too many failed logins.
 *
 * Pure Node built-ins only — no native modules, no dependencies.
 */
import http from "node:http";
import https from "node:https";
import crypto from "node:crypto";
import fs from "node:fs";

const DEFAULTS = {
	host: "0.0.0.0",
	port: 3301,
	user: "dsh",
	pass: "",
	upstream: "127.0.0.1:3080",
	secretFile: "/tmp/dsh-proxy-secret",
	certFile: "/tmp/dsh-proxy-cert.pem",
	keyFile: "/tmp/dsh-proxy-key.pem",
	maxFailures: 5,
	lockoutMs: 5 * 60 * 1000,
	cookieName: "dsh_session",
};

/**
 * Start the DSH reverse proxy.
 * @param options overrides of {@link DEFAULTS}
 * @returns { url, close(cb) }
 */
export function startProxy(options = {}) {
	const o = { ...DEFAULTS, ...Object.fromEntries(Object.entries(options).filter(([, v]) => v !== undefined)) };
	const [UPSTREAM_HOST, UPSTREAM_PORT] = String(o.upstream).split(":");
	const COOKIE_NAME = o.cookieName;
	const log = o.log || console.log;

	if (!o.pass) {
		throw new Error("dsh-proxy: pass is required");
	}

	// Persistent signing secret so existing cookies survive a restart.
	let secret;
	try {
		secret = fs.readFileSync(o.secretFile, "utf8").trim();
	} catch {
		secret = crypto.randomBytes(32).toString("hex");
		fs.writeFileSync(o.secretFile, secret, { mode: 0o600 });
	}

	const sign = (value) => crypto.createHmac("sha256", secret).update(value).digest("base64url");
	const makeToken = () => {
		const value = crypto.randomBytes(24).toString("base64url");
		return `${value}.${sign(value)}`;
	};
	const validToken = (token) => {
		if (typeof token !== "string") return false;
		const idx = token.lastIndexOf(".");
		if (idx < 0) return false;
		const value = token.slice(0, idx);
		const sig = token.slice(idx + 1);
		const expected = sign(value);
		const a = Buffer.from(sig);
		const b = Buffer.from(expected);
		return a.length === b.length && crypto.timingSafeEqual(a, b);
	};
	const getCookie = (req, name) => {
		const header = req.headers["cookie"] || "";
		for (const part of header.split(";")) {
			const eq = part.indexOf("=");
			if (eq < 0) continue;
			if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
		}
		return undefined;
	};
	const checkBasicAuth = (req) => {
		const header = req.headers["authorization"] || "";
		const m = /^Basic\s+(.+)$/i.exec(header);
		if (!m) return false;
		let decoded;
		try { decoded = Buffer.from(m[1], "base64").toString("utf8"); } catch { return false; }
		const idx = decoded.indexOf(":");
		if (idx < 0) return false;
		return decoded.slice(0, idx) === o.user && decoded.slice(idx + 1) === o.pass;
	};
	const authenticate = (req) => {
		const cookie = getCookie(req, COOKIE_NAME);
		if (cookie && validToken(cookie)) return { ok: true };
		if (checkBasicAuth(req)) return { ok: true, token: makeToken() };
		return { ok: false };
	};

	// ── rate limiting ────────────────────────────────────────────────────────
	const failures = new Map();
	const isLocked = (ip) => {
		const f = failures.get(ip);
		if (!f) return false;
		if (f.lockedUntil && f.lockedUntil > Date.now()) return true;
		if (f.lockedUntil && f.lockedUntil <= Date.now()) failures.delete(ip);
		return false;
	};
	const recordFailure = (ip) => {
		const f = failures.get(ip) || { count: 0, lockedUntil: 0 };
		f.count += 1;
		if (f.count >= o.maxFailures) { f.lockedUntil = Date.now() + o.lockoutMs; f.count = 0; }
		failures.set(ip, f);
	};
	const recordSuccess = (ip) => failures.delete(ip);
	const clientIp = (req) => req.socket?.remoteAddress || "unknown";

	/** Rewrite Host to loopback and drop Origin so DSH's trust fence passes. */
	const forwardHeaders = (headers) => {
		const h = { ...headers };
		h.host = `${UPSTREAM_HOST}:${UPSTREAM_PORT}`;
		delete h.origin;
		return h;
	};
	const unauthorized = (res, locked) => {
		if (locked) {
			res.writeHead(429, { "Retry-After": String(o.lockoutMs / 1000) });
			res.end("Too many failed attempts. Try again later.");
			return;
		}
		res.writeHead(401, { "WWW-Authenticate": 'Basic realm="dsh"' });
		res.end("Unauthorized");
	};

	const hasTls = fs.existsSync(o.certFile) && fs.existsSync(o.keyFile);
	const server = (hasTls ? https : http).createServer(
		hasTls ? { cert: fs.readFileSync(o.certFile), key: fs.readFileSync(o.keyFile) } : {},
		(req, res) => {
			const ip = clientIp(req);
			if (isLocked(ip)) return unauthorized(res, true);
			const auth = authenticate(req);
			if (!auth.ok) { recordFailure(ip); return unauthorized(res, false); }
			recordSuccess(ip);
			const proxyReq = http.request(
				{ host: UPSTREAM_HOST, port: UPSTREAM_PORT, method: req.method, path: req.url, headers: forwardHeaders(req.headers) },
				(proxyRes) => {
					const headers = { ...proxyRes.headers };
					if (auth.token) {
						// Append our session cookie to DSH's own Set-Cookie (e.g. language
						// prefs) instead of overwriting it, so DSH settings persist. Max-Age
						// keeps the session across browser restarts (no re-auth prompt).
						const sessionCookie = `${COOKIE_NAME}=${auth.token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${hasTls ? "; Secure" : ""}`;
						const dshCookies = proxyRes.headers["set-cookie"];
						headers["Set-Cookie"] = dshCookies ? [...dshCookies, sessionCookie] : sessionCookie;
					}
					res.writeHead(proxyRes.statusCode, headers);
					proxyRes.pipe(res);
				}
			);
			proxyReq.on("error", () => {
				if (!res.headersSent) { res.writeHead(502); res.end("Bad Gateway"); }
				else res.destroy();
			});
			req.on("error", () => res.destroy());
			res.on("error", () => {});
			req.pipe(proxyReq);
		}
	);

	server.on("upgrade", (req, socket, head) => {
		const ip = clientIp(req);
		if (isLocked(ip)) { socket.end(["HTTP/1.1 429 Too Many Requests", "Connection: close", "", ""].join("\r\n")); return; }
		const auth = authenticate(req);
		if (!auth.ok) {
			recordFailure(ip);
			socket.end(["HTTP/1.1 401 Unauthorized", 'WWW-Authenticate: Basic realm="dsh"', "Connection: close", "", ""].join("\r\n"));
			return;
		}
		recordSuccess(ip);
		const proxyReq = http.request({ host: UPSTREAM_HOST, port: UPSTREAM_PORT, path: req.url, headers: forwardHeaders(req.headers) });
		proxyReq.on("upgrade", (proxyRes, proxySocket, proxyHead) => {
			const statusLine = `HTTP/1.1 101 Switching Protocols\r\n`;
			const headers = Object.entries(proxyRes.headers).map(([k, v]) => `${k}: ${v}\r\n`).join("");
			let response = statusLine + headers + "\r\n";
			if (auth.token) response += `Set-Cookie: ${COOKIE_NAME}=${auth.token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${hasTls ? "; Secure" : ""}\r\n`;
			socket.write(response);
			if (proxyHead && proxyHead.length) socket.write(proxyHead);
			proxySocket.on("error", () => socket.destroy());
			socket.on("error", () => proxySocket.destroy());
			proxySocket.pipe(socket);
			socket.pipe(proxySocket);
		});
		proxyReq.on("error", () => socket.destroy());
		socket.on("error", () => proxyReq.destroy());
		if (head && head.length) proxyReq.write(head);
		proxyReq.end();
	});

	server.listen(o.port, o.host, () => {
		log(`dsh-proxy: listening on ${hasTls ? "https" : "http"}://${o.host}:${o.port} -> http://${UPSTREAM_HOST}:${UPSTREAM_PORT} (user: ${o.user}, rate-limit: ${o.maxFailures}/${o.lockoutMs / 60000}min)`);
	});

	return {
		url: `${hasTls ? "https" : "http"}://${o.host}:${o.port}`,
		close(cb) { try { server.close(cb); } catch { cb?.(); } },
	};
}
