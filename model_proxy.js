let toneModulePromise;

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
        error: error instanceof Error ? error.message : "Pretrained tone model is unavailable.",
        code: "model_unavailable",
      },
    };
  }
}

module.exports = {
  forwardToneRequest,
  getToneServiceStatus,
};
