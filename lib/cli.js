#!/usr/bin/env node
/**
 * dsh-proxy — CLI launcher.
 *
 * Env:
 *   DSH_PROXY_PORT        listen port (default 3301)
 *   DSH_PROXY_HOST        listen host (default 0.0.0.0)
 *   DSH_PROXY_USER        basic-auth username (default dsh)
 *   DSH_PROXY_PASS        basic-auth password (required)
 *   DSH_UPSTREAM          upstream host:port (default 127.0.0.1:3080)
 *   DSH_PROXY_SECRET_FILE file holding the session-signing secret
 *   DSH_PROXY_CERT        HTTPS cert path (optional; enables TLS if present)
 *   DSH_PROXY_KEY         HTTPS key path (optional)
 */
import { startProxy } from "./index.js";

startProxy({
	host: process.env.DSH_PROXY_HOST,
	port: process.env.DSH_PROXY_PORT ? Number(process.env.DSH_PROXY_PORT) : undefined,
	user: process.env.DSH_PROXY_USER,
	pass: process.env.DSH_PROXY_PASS,
	upstream: process.env.DSH_UPSTREAM,
	secretFile: process.env.DSH_PROXY_SECRET_FILE,
	certFile: process.env.DSH_PROXY_CERT,
	keyFile: process.env.DSH_PROXY_KEY,
});
