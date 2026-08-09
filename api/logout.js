const { buildCookieHeader } = require("./_auth");

module.exports = (req, res) => {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.statusCode = 405;
    res.end("Method not allowed");
    return;
  }

  res.statusCode = 200;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Set-Cookie", buildCookieHeader("", 0));
  res.end(JSON.stringify({ ok: true }));
};
