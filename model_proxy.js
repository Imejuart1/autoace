let toneModulePromise;

function formatErrorMessage(error, fallback = "Pretrained tone model is unavailable.") {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (error && typeof error === "object") {
    const details = [error.error, error.message, error.detail, error.reason, error.code];
    for (const entry of details) {
      if (typeof entry === "string" && entry.trim()) {
        return entry.trim();
      }
    }

    try {
      const serialized = JSON.stringify(error);
      if (serialized && serialized !== "{}") {
        return serialized;
      }
    } catch {
      // Ignore serialization failures and fall through to the fallback message.
    }
  }

  if (typeof error === "string" && error.trim()) {
    return error.trim();
  }

  return fallback;
}

async function getToneModule() {
  if (!toneModulePromise) {
    toneModulePromise = import("./tone_model.mjs");
  }
  return toneModulePromise;
}

function getToneServiceStatus() {
  return {
    configured: true,
    url: "vercel-node",
  };
}

async function forwardToneRequest(payload) {
  try {
    const { classifyToneRequest } = await getToneModule();
    const response = await classifyToneRequest(payload);
    return {
      ok: true,
      status: 200,
      payload: response,
    };
  } catch (error) {
    return {
      ok: false,
      status: Number(error?.statusCode) || 503,
      payload: {
        error: formatErrorMessage(error),
        code: "model_unavailable",
      },
    };
  }
}

module.exports = {
  forwardToneRequest,
  getToneServiceStatus,
};
