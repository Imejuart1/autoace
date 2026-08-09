const fs = require("node:fs");
const path = require("node:path");
const { readSession } = require("./_auth");

function sendHtml(res, filePath) {
  const html = fs.readFileSync(filePath, "utf8");
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(html);
}

function redirect(res, location) {
  res.statusCode = 302;
  res.setHeader("Location", location);
  res.setHeader("Cache-Control", "no-store");
  res.end();
}

module.exports = (req, res) => {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    res.statusCode = 405;
    res.end("Method not allowed");
    return;
  }

  const session = readSession(req);
  const route = new URL(req.url, `http://${req.headers.host || "localhost"}`).pathname;
  const root = process.cwd();
  const loginPath = path.join(root, "login.html");
  const homePath = path.join(root, "index.html");

  if (route === "/") {
    redirect(res, session ? "/home" : "/login");
    return;
  }

  if (route === "/login") {
    if (session) {
      redirect(res, "/home");
      return;
    }
    sendHtml(res, loginPath);
    return;
  }

  if (route === "/home") {
    if (!session) {
      redirect(res, "/login");
      return;
    }
    sendHtml(res, homePath);
    return;
  }

  res.statusCode = 404;
  res.end("Not found");
};
