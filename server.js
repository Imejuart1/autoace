const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 3000);
const SESSION_COOKIE_NAME = "autoace_session";
const SESSION_TTL_MS = Number(process.env.AUTOACE_SESSION_TTL_MS || 8 * 60 * 60 * 1000);
const COOKIE_SECURE = String(process.env.AUTOACE_COOKIE_SECURE || "").trim() === "1";
const AUTH_USERNAME = process.env.AUTOACE_USERNAME || "autoace";
const AUTH_PASSWORD = process.env.AUTOACE_PASSWORD || "AutoAce2026!";

const sessions = new Map();

const MIME_TYPES = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "application/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".csv", "text/csv; charset=utf-8"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".svg", "image/svg+xml"],
  [".ico", "image/x-icon"],
  [".ogg", "audio/ogg"],
  [".wav", "audio/wav"],
  [".mp3", "audio/mpeg"],
  [".m4a", "audio/mp4"],
  [".aac", "audio/aac"],
  [".flac", "audio/flac"],
  [".webm", "audio/webm"],
  [".opus", "audio/opus"],
]);

function sendJson(res, statusCode, payload, headers = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...headers,
  });
  res.end(body);
}

function sendText(res, statusCode, text, contentType = "text/plain; charset=utf-8", headers = {}) {
  res.writeHead(statusCode, {
    "Content-Type": contentType,
    "Cache-Control": "no-store",
    ...headers,
  });
  res.end(text);
}

function parseCookies(cookieHeader = "") {
  const cookies = {};
  for (const part of cookieHeader.split(";")) {
    const trimmed = part.trim();
    if (!trimmed) {
      continue;
    }
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex < 0) {
      continue;
    }
    const key = trimmed.slice(0, eqIndex).trim();
    const value = trimmed.slice(eqIndex + 1).trim();
    cookies[key] = decodeURIComponent(value);
  }
  return cookies;
}

function createCookie(name, value, options = {}) {
  const attributes = [`${name}=${encodeURIComponent(value)}`];
  attributes.push("Path=/");
  attributes.push("HttpOnly");
  attributes.push("SameSite=Lax");
  if (typeof options.maxAge === "number") {
    attributes.push(`Max-Age=${Math.max(0, Math.floor(options.maxAge))}`);
  }
  if (options.secure) {
    attributes.push("Secure");
  }
  return attributes.join("; ");
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
    req.on("error", reject);
  });
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function authenticate(username, password) {
  return safeEqual(username, AUTH_USERNAME) && safeEqual(password, AUTH_PASSWORD);
}

function createSession(username) {
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = Date.now() + SESSION_TTL_MS;
  sessions.set(token, { username, expiresAt });
  return token;
}

function getSessionFromRequest(req) {
  const cookies = parseCookies(req.headers.cookie || "");
  const token = cookies[SESSION_COOKIE_NAME];
  if (!token) {
    return null;
  }
  const session = sessions.get(token);
  if (!session) {
    return null;
  }
  if (session.expiresAt <= Date.now()) {
    sessions.delete(token);
    return null;
  }
  session.expiresAt = Date.now() + SESSION_TTL_MS;
  return { token, ...session };
}

function clearExpiredSessions() {
  const now = Date.now();
  for (const [token, session] of sessions.entries()) {
    if (session.expiresAt <= now) {
      sessions.delete(token);
    }
  }
}

function hasPublicFile(requestPath) {
  return (
    requestPath === "/index.html" ||
    requestPath === "/login.html" ||
    requestPath === "/app.js" ||
    requestPath === "/styles.css" ||
    requestPath === "/README.md" ||
    requestPath === "/TECHNICAL_MEMO.md" ||
    requestPath.startsWith("/assets/")
  );
}

function resolveStaticFile(requestPath) {
  const normalized = path.posix.normalize(requestPath.split("?")[0]);
  if (normalized === "/login") {
    return path.join(ROOT, "login.html");
  }
  if (normalized === "/home" || normalized === "/index.html" || normalized === "/dashboard") {
    return path.join(ROOT, "index.html");
  }

  if (hasPublicFile(normalized)) {
    const candidate = path.resolve(ROOT, `.${normalized}`);
    if (candidate.startsWith(ROOT)) {
      return candidate;
    }
  }

  const extension = path.extname(normalized).toLowerCase();
  if (!extension) {
    return path.join(ROOT, "index.html");
  }

  return null;
}

function isAuthenticatedRequest(req) {
  return Boolean(getSessionFromRequest(req));
}

function serveFile(res, filePath) {
  fs.readFile(filePath, (error, data) => {
    if (error) {
      sendText(res, 500, "Unable to read file");
      return;
    }

    const extension = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES.get(extension) || "application/octet-stream";
    res.writeHead(200, {
      "Content-Type": contentType,
      "Cache-Control": extension === ".html" ? "no-store" : "public, max-age=3600",
    });
    res.end(data);
  });
}

function redirect(res, location) {
  res.writeHead(302, {
    Location: location,
    "Cache-Control": "no-store",
  });
  res.end();
}

function handlePageRoute(req, res) {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const authenticated = isAuthenticatedRequest(req);

  if (url.pathname === "/" || url.pathname === "/index.html") {
    redirect(res, authenticated ? "/home" : "/login");
    return;
  }

  if (url.pathname === "/login") {
    if (authenticated) {
      redirect(res, "/home");
      return;
    }
    serveFile(res, path.join(ROOT, "login.html"));
    return;
  }

  if (url.pathname === "/home" || url.pathname === "/dashboard") {
    if (!authenticated) {
      redirect(res, "/login");
      return;
    }
    serveFile(res, path.join(ROOT, "index.html"));
    return;
  }

  const filePath = resolveStaticFile(url.pathname);
  if (!filePath) {
    sendText(res, 404, "Not found");
    return;
  }

  serveFile(res, filePath);
}

function serveStatic(req, res) {
  const filePath = resolveStaticFile(req.url || "/");
  if (!filePath) {
    sendText(res, 404, "Not found");
    return;
  }

  serveFile(res, filePath);
}

async function handleLogin(req, res) {
  const bodyText = await readRequestBody(req);
  let payload;

  try {
    payload = bodyText ? JSON.parse(bodyText) : {};
  } catch {
    sendJson(res, 400, { error: "Request body must be valid JSON." });
    return;
  }

  const username = String(payload.username || "").trim();
  const password = String(payload.password || "");
  if (!authenticate(username, password)) {
    sendJson(res, 401, { error: "Invalid username or password." });
    return;
  }

  const token = createSession(username);
  sendJson(
    res,
    200,
    {
      authenticated: true,
      username,
    },
    {
      "Set-Cookie": createCookie(SESSION_COOKIE_NAME, token, {
        maxAge: SESSION_TTL_MS / 1000,
        secure: COOKIE_SECURE,
      }),
    },
  );
}

function handleMe(req, res) {
  const session = getSessionFromRequest(req);
  if (!session) {
    sendJson(res, 401, { authenticated: false });
    return;
  }

  sendJson(res, 200, {
    authenticated: true,
    username: session.username,
    expiresInSeconds: Math.max(0, Math.round((session.expiresAt - Date.now()) / 1000)),
  });
}

function handleLogout(req, res) {
  const cookies = parseCookies(req.headers.cookie || "");
  const token = cookies[SESSION_COOKIE_NAME];
  if (token) {
    sessions.delete(token);
  }

  sendJson(
    res,
    200,
    { ok: true },
    {
      "Set-Cookie": createCookie(SESSION_COOKIE_NAME, "", {
        maxAge: 0,
        secure: COOKIE_SECURE,
      }),
    },
  );
}

const server = http.createServer((req, res) => {
  clearExpiredSessions();

  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  if (url.pathname === "/api/me" && req.method === "GET") {
    handleMe(req, res);
    return;
  }

  if (url.pathname === "/api/login" && req.method === "POST") {
    handleLogin(req, res).catch((error) => {
      sendJson(res, 500, { error: error instanceof Error ? error.message : "Unable to sign in." });
    });
    return;
  }

  if (url.pathname === "/api/logout" && req.method === "POST") {
    handleLogout(req, res);
    return;
  }

  if (url.pathname.startsWith("/api/")) {
    sendJson(res, 404, { error: "Not found" });
    return;
  }

  if (req.method === "GET" && url.pathname === "/") {
    redirect(res, getSessionFromRequest(req) ? "/home" : "/login");
    return;
  }

  if (req.method === "GET" && url.pathname === "/dashboard") {
    redirect(res, "/home");
    return;
  }

  if (req.method === "GET" && url.pathname === "/login") {
    if (getSessionFromRequest(req)) {
      redirect(res, "/home");
      return;
    }
    serveStatic(req, res);
    return;
  }

  if (req.method === "GET" && url.pathname === "/home") {
    if (!getSessionFromRequest(req)) {
      redirect(res, "/login");
      return;
    }
    serveStatic(req, res);
    return;
  }

  if (req.method === "GET") {
    handlePageRoute(req, res);
    return;
  }

  res.writeHead(405, {
    Allow: "GET, POST",
    "Cache-Control": "no-store",
  });
  res.end("Method not allowed");
});

server.listen(PORT, () => {
  console.log(`AutoAce dashboard running at http://localhost:${PORT}`);
  console.log(`Login with ${AUTH_USERNAME} / ${AUTH_PASSWORD}`);
});
