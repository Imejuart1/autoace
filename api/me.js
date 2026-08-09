const { readSession } = require("./_auth");

module.exports = (req, res) => {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    res.statusCode = 405;
    res.end("Method not allowed");
    return;
  }

  const session = readSession(req);
  if (!session) {
    res.statusCode = 401;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ authenticated: false }));
    return;
  }

  res.statusCode = 200;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(
    JSON.stringify({
      authenticated: true,
      username: session.username,
      expiresInSeconds: Math.max(0, Math.round((session.exp - Date.now()) / 1000)),
    }),
  );
};
