const {
  authenticate,
  buildCookieHeader,
  createSessionCookie,
  readJsonBody,
} = require("./_auth");

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.statusCode = 405;
    res.end("Method not allowed");
    return;
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ error: "Request body must be valid JSON." }));
    return;
  }

  const username = body.username || "";
  const password = body.password || "";
  if (!authenticate(username, password)) {
    res.statusCode = 401;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ error: "Invalid username or password." }));
    return;
  }

  const token = createSessionCookie(username);
  res.statusCode = 200;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Set-Cookie", buildCookieHeader(token, 8 * 60 * 60));
  res.end(JSON.stringify({ authenticated: true, username: String(username).trim() }));
};
