const crypto = require("node:crypto");

const COOKIE_NAME = "autoace_session";
const DEFAULT_USERNAME = process.env.AUTOACE_USERNAME || "autoace";
const DEFAULT_PASSWORD = process.env.AUTOACE_PASSWORD || "AutoAce2026!";
const SESSION_TTL_MS = Number(process.env.AUTOACE_SESSION_TTL_MS || 8 * 60 * 60 * 1000);
const SESSION_SECRET = process.env.AUTOACE_AUTH_SECRET || "autoace-vercel-secret";

function base64UrlEncode(value) {
  return Buffer.from(value).toString("base64url");
}

function base64UrlDecode(value) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function parseCookies(cookieHeader = "") {
  const cookies = {};
  for (const part of cookieHeader.split(";")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const index = trimmed.indexOf("=");
    if (index < 0) continue;
    cookies[trimmed.slice(0, index)] = decodeURIComponent(trimmed.slice(index + 1));
  }
  return cookies;
}

function signPayload(payload) {
  const body = base64UrlEncode(JSON.stringify(payload));
  const signature = crypto.createHmac("sha256", SESSION_SECRET).update(body).digest("base64url");
  return `${body}.${signature}`;
}

function verifyPayload(token) {
  if (!token || typeof token !== "string") {
    return null;
  }

  const parts = token.split(".");
  if (parts.length !== 2) {
    return null;
  }

  const [body, signature] = parts;
  const expected = crypto.createHmac("sha256", SESSION_SECRET).update(body).digest();
  const provided = Buffer.from(signature, "base64url");
  if (expected.length !== provided.length || !crypto.timingSafeEqual(expected, provided)) {
    return null;
  }

  try {
    const payload = JSON.parse(base64UrlDecode(body));
    if (!payload || typeof payload !== "object") {
      return null;
    }
    if (typeof payload.exp !== "number" || payload.exp <= Date.now()) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

function createSessionCookie(username) {
  const payload = {
    username,
    exp: Date.now() + SESSION_TTL_MS,
  };
  return signPayload(payload);
}

function buildCookieHeader(value, maxAgeSeconds) {
  const parts = [`${COOKIE_NAME}=${encodeURIComponent(value)}`, "Path=/", "HttpOnly", "SameSite=Lax"];
  if (typeof maxAgeSeconds === "number") {
    parts.push(`Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`);
  }
  const secureCookie =
    String(process.env.AUTOACE_COOKIE_SECURE || "").trim() === "1" ||
    String(process.env.VERCEL_ENV || "").trim().toLowerCase() === "production";
  if (secureCookie) {
    parts.push("Secure");
  }
  return parts.join("; ");
}

function readSession(req) {
  const cookies = parseCookies(req.headers.cookie || "");
  const payload = verifyPayload(cookies[COOKIE_NAME]);
  if (!payload) {
    return null;
  }
  return payload;
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8");
      if (!text) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(text));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function authenticate(username, password) {
  const suppliedUsername = Buffer.from(String(username || "").trim());
  const expectedUsername = Buffer.from(DEFAULT_USERNAME);
  const suppliedPassword = Buffer.from(String(password || ""));
  const expectedPassword = Buffer.from(DEFAULT_PASSWORD);
  const usernameMatches =
    suppliedUsername.length === expectedUsername.length &&
    crypto.timingSafeEqual(suppliedUsername, expectedUsername);
  const passwordMatches =
    suppliedPassword.length === expectedPassword.length &&
    crypto.timingSafeEqual(suppliedPassword, expectedPassword);
  return usernameMatches && passwordMatches;
}

module.exports = {
  COOKIE_NAME,
  DEFAULT_PASSWORD,
  DEFAULT_USERNAME,
  SESSION_TTL_MS,
  buildCookieHeader,
  createSessionCookie,
  authenticate,
  parseCookies,
  readJsonBody,
  readSession,
  verifyPayload,
};
