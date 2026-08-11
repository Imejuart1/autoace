const { forwardToneRequest } = require("../model_proxy");
const { readJsonBody, readSession } = require("./_auth");

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.statusCode = 405;
    res.end("Method not allowed");
    return;
  }

  if (!readSession(req)) {
    res.statusCode = 401;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ error: "Authentication required." }));
    return;
  }

  let payload;
  try {
    payload = await readJsonBody(req);
  } catch {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ error: "Request body must be valid JSON." }));
    return;
  }

  const response = await forwardToneRequest(payload);
  res.statusCode = response.status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(response.payload));
};

module.exports.config = {
  maxDuration: 60,
};
