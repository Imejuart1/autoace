const SUPPORTED_AUDIO_EXTENSIONS = new Set([
  ".wav",
  ".ogg",
  ".mp3",
  ".m4a",
  ".aac",
  ".flac",
  ".webm",
  ".opus",
]);

const TONE_LABELS = ["neutral", "satisfied", "frustrated", "upset", "distressed"];
const INTENSITY_LABELS = ["low", "medium", "high"];
const NOISE_SEVERITY_LABELS = ["none", "low", "medium", "high"];
const QUALITY_LABELS = ["clear", "slightly_impaired", "severely_impaired"];
const SAMPLE_FREQUENCIES = [120, 240, 360, 480, 600, 800, 1200, 1600, 2400, 3200, 4000];
const TONE_MODEL_ENDPOINT = "/api/tone";
const TONE_MODEL_SAMPLE_RATE = 16000;
const TONE_MODEL_SEGMENT_SECONDS = 18;
const TONE_MODEL_MAX_SEGMENTS = 5;

const state = {
  sourceFiles: [],
  audioFiles: [],
  manifestRows: [],
  manifestMap: new Map(),
  results: [],
  rawRows: [],
  processing: false,
  report: null,
  downloadUrls: [],
  analysisTiming: null,
  toneModel: {
    status: "unknown",
    reason: "",
  },
};

const dom = {
  authScreen: document.getElementById("authScreen"),
  appRoot: document.getElementById("appRoot"),
  loginForm: document.getElementById("loginForm"),
  loginUsername: document.getElementById("loginUsername"),
  loginPassword: document.getElementById("loginPassword"),
  loginMessage: document.getElementById("loginMessage"),
  logoutButton: document.getElementById("logoutButton"),
  singleAudioInput: document.getElementById("singleAudioInput"),
  folderInput: document.getElementById("folderInput"),
  zipInput: document.getElementById("zipInput"),
  manifestInput: document.getElementById("manifestInput"),
  dropZone: document.getElementById("dropZone"),
  analyzeButton: document.getElementById("analyzeButton"),
  clearButton: document.getElementById("clearButton"),
  downloadJsonButton: document.getElementById("downloadJsonButton"),
  downloadCsvButton: document.getElementById("downloadCsvButton"),
  downloadJsonButtonBottom: document.getElementById("downloadJsonButtonBottom"),
  downloadCsvButtonBottom: document.getElementById("downloadCsvButtonBottom"),
  batchStatus: document.getElementById("batchStatus"),
  fileCount: document.getElementById("fileCount"),
  audioCount: document.getElementById("audioCount"),
  manifestCount: document.getElementById("manifestCount"),
  errorCount: document.getElementById("errorCount"),
  progressLabel: document.getElementById("progressLabel"),
  progressValue: document.getElementById("progressValue"),
  progressBar: document.getElementById("progressBar"),
  messages: document.getElementById("messages"),
  resultsBody: document.getElementById("resultsBody"),
  resultsPanel: document.querySelector(".results-panel"),
  summaryCards: document.getElementById("summaryCards"),
  validationSummary: document.getElementById("validationSummary"),
  confusionMatrix: document.getElementById("confusionMatrix"),
  opsSummary: document.getElementById("opsSummary"),
  debugDump: document.getElementById("debugDump"),
};

const AUTH_ENDPOINTS = {
  me: "/api/me",
  login: "/api/login",
  logout: "/api/logout",
};

function setAuthMessage(text, kind = "") {
  if (!dom.loginMessage) {
    return;
  }
  dom.loginMessage.textContent = text;
  dom.loginMessage.classList.toggle("error", kind === "error");
}

function setAppVisible(isVisible) {
  if (dom.authScreen) {
    dom.authScreen.hidden = isVisible;
  }
  if (dom.appRoot) {
    dom.appRoot.hidden = !isVisible;
  }
}

async function readJsonResponse(response) {
  const text = await response.text();
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

async function fetchSession() {
  const response = await fetch(AUTH_ENDPOINTS.me, {
    credentials: "include",
    headers: {
      Accept: "application/json",
    },
  });
  if (!response.ok) {
    return null;
  }
  return readJsonResponse(response);
}

async function submitLogin(username, password) {
  const response = await fetch(AUTH_ENDPOINTS.login, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      username: String(username || "").trim(),
      password: String(password || ""),
    }),
  });

  const payload = await readJsonResponse(response);
  if (!response.ok) {
    throw new Error(payload?.error || payload?.message || "Invalid username or password.");
  }
  return payload;
}

async function submitLogout() {
  await fetch(AUTH_ENDPOINTS.logout, {
    method: "POST",
    credentials: "include",
    headers: {
      Accept: "application/json",
    },
  });
}

function completeLogin() {
  if (dom.loginUsername) {
    dom.loginUsername.value = "";
  }
  if (dom.loginPassword) {
    dom.loginPassword.value = "";
  }
  setAppVisible(true);
  clearState(true);
}

async function initializeAuth() {
  if (dom.loginForm && !dom.appRoot) {
    dom.loginForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const username = dom.loginUsername?.value || "";
      const password = dom.loginPassword?.value || "";
      setAuthMessage("Signing in...");
      dom.loginForm.querySelector("button[type='submit']")?.setAttribute("disabled", "disabled");
      try {
        await submitLogin(username, password);
        window.location.replace("/home");
      } catch (error) {
        setAuthMessage(error instanceof Error ? error.message : "Invalid username or password.", "error");
        dom.loginPassword?.focus();
      } finally {
        dom.loginForm.querySelector("button[type='submit']")?.removeAttribute("disabled");
      }
    });

    setAuthMessage("Checking your session...");
    try {
      const session = await fetchSession();
      if (session?.authenticated) {
        window.location.replace("/home");
        return;
      }
    } catch {
      // Fall through to the sign-in screen when the server is not reachable.
    }
    setAuthMessage("Use the shared AutoAce credentials to sign in.");
    return;
  }

  if (dom.appRoot && !dom.loginForm) {
    const session = await fetchSession().catch(() => null);
    if (!session?.authenticated) {
      window.location.replace("/login");
      return;
    }

    if (dom.logoutButton) {
      dom.logoutButton.addEventListener("click", async () => {
        dom.logoutButton.disabled = true;
        try {
          await submitLogout();
        } finally {
          dom.logoutButton.disabled = false;
          window.location.replace("/login");
        }
      });
    }

    setAppVisible(true);
    clearState(true);
    return;
  }

  setAppVisible(true);
}

function setMessage(html) {
  dom.messages.innerHTML = html;
}

function setStatus(text, kind = "info") {
  dom.batchStatus.textContent = text;
  dom.batchStatus.dataset.kind = kind;
}

function scrollToResultsPanel() {
  if (!dom.resultsPanel) {
    return;
  }
  window.requestAnimationFrame(() => {
    dom.resultsPanel.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  });
}

function setProgress(label, value) {
  dom.progressLabel.textContent = label;
  dom.progressValue.textContent = `${Math.round(value * 100)}%`;
  dom.progressBar.style.width = `${Math.max(0, Math.min(100, value * 100))}%`;
}

function setDownloadLink(link, href, filename, enabled) {
  if (!link) {
    return;
  }
  link.href = enabled ? href : "#";
  link.download = enabled ? filename : "";
  link.setAttribute("aria-disabled", enabled ? "false" : "true");
  link.classList.toggle("disabled", !enabled);
}

function syncDownloadLinks(hrefJson = "#", hrefCsv = "#", enabled = false) {
  setDownloadLink(dom.downloadJsonButton, hrefJson, "predictions.json", enabled);
  setDownloadLink(dom.downloadCsvButton, hrefCsv, "predictions.csv", enabled);
  setDownloadLink(dom.downloadJsonButtonBottom, hrefJson, "predictions.json", enabled);
  setDownloadLink(dom.downloadCsvButtonBottom, hrefCsv, "predictions.csv", enabled);
}

function setCounters() {
  dom.fileCount.textContent = String(state.sourceFiles.length);
  dom.audioCount.textContent = String(state.audioFiles.length);
  dom.manifestCount.textContent = String(state.manifestRows.length);
  const errorCount = state.results.filter((row) => row.status !== "ok").length;
  dom.errorCount.textContent = String(errorCount);
}

function clearState(keepMessage = false) {
  for (const url of state.downloadUrls) {
    URL.revokeObjectURL(url);
  }
  state.sourceFiles = [];
  state.audioFiles = [];
  state.manifestRows = [];
  state.manifestMap = new Map();
  state.results = [];
  state.rawRows = [];
  state.processing = false;
  state.report = null;
  state.downloadUrls = [];
  state.analysisTiming = null;
  state.toneModel = { status: "unknown", reason: "" };
  dom.resultsBody.innerHTML = '<tr><td colspan="10" class="empty-state">No analysis run yet.</td></tr>';
  dom.summaryCards.innerHTML = "";
  dom.validationSummary.innerHTML = "";
  dom.confusionMatrix.innerHTML = "";
  dom.opsSummary.innerHTML = "";
  dom.debugDump.textContent = "";
  syncDownloadLinks();
  setProgress("Idle", 0);
  setStatus("Waiting for files");
  setCounters();
  if (!keepMessage) {
    setMessage("Ready. Select a folder, ZIP archive, or a single audio file, then run the analysis.");
  }
}

function normalizeName(name) {
  return String(name || "")
    .replace(/\\/g, "/")
    .split("/")
    .pop()
    .trim();
}

function fileExtension(name) {
  const normalized = normalizeName(name).toLowerCase();
  const idx = normalized.lastIndexOf(".");
  return idx >= 0 ? normalized.slice(idx) : "";
}

function csvEscape(value) {
  const text = value == null ? "" : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function parseCsv(text) {
  const source = text.replace(/^\ufeff/, "");
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    const next = source[i + 1];

    if (inQuotes) {
      if (char === '"' && next === '"') {
        cell += '"';
        i += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        cell += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      continue;
    }

    if (char === ",") {
      row.push(cell);
      cell = "";
      continue;
    }

    if (char === "\r") {
      continue;
    }

    if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }

    cell += char;
  }

  if (cell.length || row.length) {
    row.push(cell);
    rows.push(row);
  }

  return rows.filter((record) => record.some((entry) => String(entry).trim() !== ""));
}

async function readFileText(file) {
  return await file.text();
}

function isAudioFile(file) {
  return SUPPORTED_AUDIO_EXTENSIONS.has(fileExtension(file.name));
}

function pickPrimaryFiles(files) {
  const audioFiles = [];
  const manifestFiles = [];
  const zipFiles = [];

  for (const file of files) {
    const ext = fileExtension(file.name);
    if (ext === ".csv") {
      manifestFiles.push(file);
    } else if (ext === ".zip") {
      zipFiles.push(file);
    } else if (isAudioFile(file)) {
      audioFiles.push(file);
    }
  }

  return { audioFiles, manifestFiles, zipFiles };
}

function readArrayBufferFromFile(file) {
  return file.arrayBuffer();
}

async function inflateRaw(data) {
  if (typeof DecompressionStream === "undefined") {
    throw new Error("ZIP deflate support is not available in this browser");
  }
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  const response = new Response(stream);
  return new Uint8Array(await response.arrayBuffer());
}

function findEndOfCentralDirectory(bytes) {
  for (let i = bytes.length - 22; i >= 0; i -= 1) {
    if (
      bytes[i] === 0x50 &&
      bytes[i + 1] === 0x4b &&
      bytes[i + 2] === 0x05 &&
      bytes[i + 3] === 0x06
    ) {
      return i;
    }
  }
  throw new Error("ZIP end-of-central-directory record not found");
}

async function extractZipEntries(file) {
  const buffer = await readArrayBufferFromFile(file);
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const eocd = findEndOfCentralDirectory(bytes);
  const totalEntries = view.getUint16(eocd + 10, true);
  const centralDirectoryOffset = view.getUint32(eocd + 16, true);
  const entries = [];
  let offset = centralDirectoryOffset;

  for (let i = 0; i < totalEntries; i += 1) {
    const signature = view.getUint32(offset, true);
    if (signature !== 0x02014b50) {
      throw new Error(`Unexpected ZIP central directory signature at offset ${offset}`);
    }

    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localHeaderOffset = view.getUint32(offset + 42, true);
    const nameBytes = bytes.slice(offset + 46, offset + 46 + nameLength);
    const filename = new TextDecoder("utf-8").decode(nameBytes);

    offset += 46 + nameLength + extraLength + commentLength;

    if (filename.endsWith("/")) {
      continue;
    }

    const localHeaderSignature = view.getUint32(localHeaderOffset, true);
    if (localHeaderSignature !== 0x04034b50) {
      throw new Error(`Unexpected ZIP local header signature for ${filename}`);
    }

    const localNameLength = view.getUint16(localHeaderOffset + 26, true);
    const localExtraLength = view.getUint16(localHeaderOffset + 28, true);
    const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength;
    const compressed = bytes.slice(dataStart, dataStart + compressedSize);
    let data;

    if (method === 0) {
      data = compressed;
    } else if (method === 8) {
      data = await inflateRaw(compressed);
    } else {
      throw new Error(`Unsupported ZIP compression method ${method} in ${filename}`);
    }

    entries.push({
      name: normalizeName(filename),
      path: filename,
      extension: fileExtension(filename),
      data,
    });
  }

  return entries;
}

function percentile(values, p) {
  if (!values.length) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * p;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) {
    return sorted[lower];
  }
  const weight = index - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

function mean(values) {
  if (!values.length) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function std(values) {
  if (values.length < 2) {
    return 0;
  }
  const avg = mean(values);
  const variance = values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function median(values) {
  return percentile(values, 0.5);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function hannWindow(length) {
  const window = new Float32Array(length);
  for (let i = 0; i < length; i += 1) {
    window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (length - 1));
  }
  return window;
}

function computeRms(frame) {
  let sumSquares = 0;
  for (let i = 0; i < frame.length; i += 1) {
    sumSquares += frame[i] * frame[i];
  }
  return Math.sqrt(sumSquares / frame.length);
}

function computePeak(frame) {
  let peak = 0;
  for (let i = 0; i < frame.length; i += 1) {
    const value = Math.abs(frame[i]);
    if (value > peak) {
      peak = value;
    }
  }
  return peak;
}

function computeZeroCrossingRate(frame) {
  let crossings = 0;
  for (let i = 1; i < frame.length; i += 1) {
    if ((frame[i - 1] >= 0 && frame[i] < 0) || (frame[i - 1] < 0 && frame[i] >= 0)) {
      crossings += 1;
    }
  }
  return crossings / Math.max(1, frame.length - 1);
}

function goertzelPower(frame, sampleRate, frequency) {
  const k = Math.round((frame.length * frequency) / sampleRate);
  const omega = (2 * Math.PI * k) / frame.length;
  const coeff = 2 * Math.cos(omega);
  let q0 = 0;
  let q1 = 0;
  let q2 = 0;
  for (let i = 0; i < frame.length; i += 1) {
    q0 = coeff * q1 - q2 + frame[i];
    q2 = q1;
    q1 = q0;
  }
  return q1 * q1 + q2 * q2 - coeff * q1 * q2;
}

function estimatePitch(frame, sampleRate) {
  const minLag = Math.max(1, Math.floor(sampleRate / 350));
  const maxLag = Math.min(frame.length - 1, Math.floor(sampleRate / 70));
  let bestLag = 0;
  let bestCorr = 0;
  let secondBest = 0;

  let meanValue = 0;
  for (let i = 0; i < frame.length; i += 1) {
    meanValue += frame[i];
  }
  meanValue /= frame.length;

  const centered = new Float32Array(frame.length);
  for (let i = 0; i < frame.length; i += 1) {
    centered[i] = frame[i] - meanValue;
  }

  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let numerator = 0;
    let energyA = 0;
    let energyB = 0;
    for (let i = 0; i < centered.length - lag; i += 1) {
      const a = centered[i];
      const b = centered[i + lag];
      numerator += a * b;
      energyA += a * a;
      energyB += b * b;
    }
    const denominator = Math.sqrt(energyA * energyB) + 1e-12;
    const corr = numerator / denominator;
    if (corr > bestCorr) {
      secondBest = bestCorr;
      bestCorr = corr;
      bestLag = lag;
    } else if (corr > secondBest) {
      secondBest = corr;
    }
  }

  if (bestCorr < 0.22 || bestLag === 0) {
    return { pitch: null, confidence: bestCorr, harmonicity: 0 };
  }

  return {
    pitch: sampleRate / bestLag,
    confidence: bestCorr,
    harmonicity: Math.max(0, bestCorr - secondBest),
  };
}

function buildFrameSlices(samples, frameSize, hopSize) {
  const frames = [];
  for (let offset = 0; offset + frameSize <= samples.length; offset += hopSize) {
    frames.push(samples.subarray(offset, offset + frameSize));
  }
  return frames;
}

function mergeRuns(flags, hopSeconds) {
  const runs = [];
  let start = null;
  for (let i = 0; i < flags.length; i += 1) {
    if (flags[i]) {
      if (start === null) {
        start = i;
      }
    } else if (start !== null) {
      runs.push({ start, end: i - 1, seconds: (i - start) * hopSeconds });
      start = null;
    }
  }
  if (start !== null) {
    runs.push({ start, end: flags.length - 1, seconds: (flags.length - start) * hopSeconds });
  }
  return runs;
}

function detectNoiseType({
  lowFreqRatio,
  midFreqRatio,
  highFreqRatio,
  flatness,
  speechSegmentCount,
  noiseFloor,
  harmonicity,
  pitchCount,
}) {
  if (speechSegmentCount > 250 || noiseFloor > 0.0008) {
    return "sharp static";
  }
  if (speechSegmentCount > 80 && midFreqRatio > 0.45) {
    return "TV";
  }
  if (lowFreqRatio > 0.48 && flatness > 0.42) {
    return "road noise";
  }
  if (lowFreqRatio > 0.42 && flatness <= 0.42 && highFreqRatio < 0.22) {
    return "wind";
  }
  if (harmonicity > 0.18 && pitchCount > 6 && highFreqRatio < 0.35) {
    return "music";
  }
  if (midFreqRatio > 0.35 && pitchCount > 4 && flatness > 0.25) {
    return "office chatter";
  }
  if (speechSegmentCount > 80 && harmonicity > 0.01) {
    return "background noise";
  }
  if (lowFreqRatio > 0.25 && midFreqRatio > 0.22) {
    return "mechanical noise";
  }
  return "background noise";
}

function classifyTone(metrics) {
  const {
    speechEnergy,
    noiseRatio,
    pitchMean,
    pitchStd,
    zcrSpeech,
    segmentDensity,
    clippingRate,
    longSilence,
    qualityPenalty,
  } = metrics;

  const loudnessScore = clamp(speechEnergy * 14, 0, 1);
  const pitchScore = clamp((pitchMean - 150) / 120, 0, 1);
  const variabilityScore = clamp(pitchStd / 55, 0, 1);
  const articulationScore = clamp(zcrSpeech / 0.09, 0, 1);
  const movementScore = clamp(segmentDensity / 2.4, 0, 1);
  const stressScore = clamp(
    loudnessScore * 0.36 +
      pitchScore * 0.28 +
      variabilityScore * 0.18 +
      articulationScore * 0.08 +
      movementScore * 0.1 +
      clippingRate * 1.6 +
      qualityPenalty * 0.12,
    0,
    1,
  );

  if (clippingRate > 0.02 || (longSilence && speechEnergy > 0.08 && pitchStd > 60)) {
    return { tone: "distressed", intensity: "high", confidenceHint: 0.78 };
  }

  if (speechEnergy < 0.04) {
    return {
      tone: "neutral",
      intensity: segmentDensity > 1.3 ? "medium" : "low",
      confidenceHint: 0.76,
    };
  }

  if (speechEnergy > 0.075 && pitchMean >= 220) {
    return { tone: "upset", intensity: "high", confidenceHint: 0.84 };
  }

  if (speechEnergy > 0.06 && pitchMean >= 170 && pitchMean <= 210 && segmentDensity > 1.2) {
    return { tone: "satisfied", intensity: "medium", confidenceHint: 0.8 };
  }

  if (speechEnergy > 0.05 && pitchMean >= 190 && pitchMean <= 220) {
    return {
      tone: "frustrated",
      intensity: stressScore > 0.6 ? "high" : "medium",
      confidenceHint: 0.71,
    };
  }

  if (stressScore > 0.62) {
    return {
      tone: "upset",
      intensity: "high",
      confidenceHint: 0.74,
    };
  }

  if (stressScore > 0.42) {
    return {
      tone: "frustrated",
      intensity: "medium",
      confidenceHint: 0.67,
    };
  }

  return {
    tone: "neutral",
    intensity: segmentDensity > 1.0 ? "medium" : "low",
    confidenceHint: 0.64,
  };
}

function deriveQuality({ noiseSeverity, clippingRate, noiseRatio, signalToNoise, lowVolume }) {
  if (noiseSeverity === "high" || clippingRate > 0.06 || signalToNoise < 2.2) {
    return "severely_impaired";
  }
  if (clippingRate > 0.015 || noiseRatio > 0.26 || lowVolume) {
    return "slightly_impaired";
  }
  return "clear";
}

function analyzeSamples(samples, sampleRate) {
  const frameSize = Math.max(512, Math.round(sampleRate * 0.03));
  const hopSize = Math.max(256, Math.round(sampleRate * 0.01));
  const frames = buildFrameSlices(samples, frameSize, hopSize);
  const window = hannWindow(frameSize);
  const audioDurationSeconds = samples.length / sampleRate;

  const rmsFrames = [];
  const peakFrames = [];
  const zcrFrames = [];
  const frameFeatures = [];

  for (const frame of frames) {
    const windowed = new Float32Array(frameSize);
    for (let i = 0; i < frameSize; i += 1) {
      windowed[i] = frame[i] * window[i];
    }
    const rms = computeRms(windowed);
    rmsFrames.push(rms);
    peakFrames.push(computePeak(windowed));
    zcrFrames.push(computeZeroCrossingRate(windowed));
  }

  const quietThreshold = percentile(rmsFrames, 0.2);
  const speechThreshold = Math.max(quietThreshold * 2.3, percentile(rmsFrames, 0.65) * 0.65, 0.0012);
  const speechFlags = rmsFrames.map((value) => value >= speechThreshold);
  const speechRuns = mergeRuns(speechFlags, hopSize / sampleRate);
  const silenceRuns = mergeRuns(speechFlags.map((flag) => !flag), hopSize / sampleRate);

  const speechFrames = [];
  const silenceFrames = [];
  let clippingSamples = 0;
  let totalSamples = 0;

  for (let frameIndex = 0; frameIndex < frames.length; frameIndex += 1) {
    const frame = frames[frameIndex];
    totalSamples += frame.length;
    for (let i = 0; i < frame.length; i += 1) {
      if (Math.abs(frame[i]) >= 0.99) {
        clippingSamples += 1;
      }
    }

    if (speechFlags[frameIndex]) {
      speechFrames.push({
        index: frameIndex,
        rms: rmsFrames[frameIndex],
        peak: peakFrames[frameIndex],
        zcr: zcrFrames[frameIndex],
        pitch: estimatePitch(frame, sampleRate),
        frame,
      });
    } else {
      silenceFrames.push({
        index: frameIndex,
        rms: rmsFrames[frameIndex],
        peak: peakFrames[frameIndex],
        zcr: zcrFrames[frameIndex],
      });
    }
  }

  const speechRmsValues = speechFrames.map((entry) => entry.rms);
  const silenceRmsValues = silenceFrames.map((entry) => entry.rms);
  const speechZcrValues = speechFrames.map((entry) => entry.zcr);
  const pitchValues = speechFrames
    .map((entry) => entry.pitch.pitch)
    .filter((value) => typeof value === "number" && Number.isFinite(value));
  const pitchConfidences = speechFrames.map((entry) => entry.pitch.confidence);
  const pitchHarmonics = speechFrames.map((entry) => entry.pitch.harmonicity);

  const totalSpeechFrames = speechFrames.length;
  const silenceRatio = 1 - totalSpeechFrames / Math.max(1, frames.length);
  const pauseRuns = silenceRuns.map((run) => run.seconds);
  const maxSilenceSeconds = pauseRuns.length ? Math.max(...pauseRuns) : 0;
  const longSilencePresent = maxSilenceSeconds >= Math.max(10, audioDurationSeconds * 0.15);
  const speechSegmentCount = speechRuns.length;
  const segmentDensity = speechSegmentCount / Math.max(0.001, audioDurationSeconds);

  const noiseFloor = silenceRmsValues.length ? median(silenceRmsValues) : percentile(rmsFrames, 0.15);
  const meanSpeechRms = speechRmsValues.length ? mean(speechRmsValues) : median(rmsFrames);
  const meanSpeechZcr = speechZcrValues.length ? mean(speechZcrValues) : mean(zcrFrames);
  const pitchMean = pitchValues.length ? mean(pitchValues) : 0;
  const pitchStd = pitchValues.length ? std(pitchValues) : 0;
  const pitchConfidenceMean = pitchConfidences.length ? mean(pitchConfidences) : 0;
  const pitchHarmonicityMean = pitchHarmonics.length ? mean(pitchHarmonics) : 0;
  const clipRate = clippingSamples / Math.max(1, totalSamples);
  const signalToNoise = noiseFloor > 0 ? meanSpeechRms / noiseFloor : 8;
  const lowVolume = meanSpeechRms < 0.0048;
  const pauseRatio = silenceRatio;

  const speechEnergy = meanSpeechRms;
  const noiseRatio = clamp(noiseFloor / Math.max(meanSpeechRms, 1e-6), 0, 10);

  const bandTotals = new Map();
  let bandPowerCount = 0;
  let transientFrames = 0;
  let voicedPitchCount = 0;

  for (const entry of speechFrames) {
    const frame = entry.frame;
    const powers = SAMPLE_FREQUENCIES.map((frequency) => goertzelPower(frame, sampleRate, frequency));
    const powerSum = powers.reduce((sum, value) => sum + value, 0) + 1e-12;
    const flatness = Math.exp(powers.reduce((sum, value) => sum + Math.log(value + 1e-12), 0) / powers.length) / (powerSum / powers.length);
    frameFeatures.push({
      flatness,
      powers,
      pitch: entry.pitch.pitch,
      harmonicity: entry.pitch.harmonicity,
      zcr: entry.zcr,
      rms: entry.rms,
      peak: entry.peak,
    });

    for (let i = 0; i < SAMPLE_FREQUENCIES.length; i += 1) {
      bandTotals.set(SAMPLE_FREQUENCIES[i], (bandTotals.get(SAMPLE_FREQUENCIES[i]) || 0) + powers[i]);
    }

    const hasTransient = entry.zcr > 0.16 && entry.rms < meanSpeechRms * 0.9 && entry.peak > 0.25;
    if (hasTransient) {
      transientFrames += 1;
    }
    if (typeof entry.pitch.pitch === "number") {
      voicedPitchCount += 1;
    }
    bandPowerCount += 1;
  }

  const averagedBands = SAMPLE_FREQUENCIES.map((frequency) => bandTotals.get(frequency) || 0);
  const bandSum = averagedBands.reduce((sum, value) => sum + value, 0) + 1e-12;
  const lowFreqRatio = averagedBands.slice(0, 3).reduce((sum, value) => sum + value, 0) / bandSum;
  const midFreqRatio = averagedBands.slice(3, 7).reduce((sum, value) => sum + value, 0) / bandSum;
  const highFreqRatio = averagedBands.slice(7).reduce((sum, value) => sum + value, 0) / bandSum;
  const flatnessValues = frameFeatures.map((entry) => entry.flatness);
  const flatness = flatnessValues.length ? mean(flatnessValues) : 0;
  const harmonicity = frameFeatures.length ? mean(frameFeatures.map((entry) => entry.harmonicity)) : 0;
  const transientRate = frameFeatures.length ? transientFrames / frameFeatures.length : 0;
  const noisePresent =
    segmentDensity > 1.2 || noiseFloor > 0.00075 || noiseRatio > 0.16 || flatness > 0.18 || transientRate > 0.02;

  const noiseSeverity = !noisePresent
    ? "none"
    : segmentDensity > 2.3 || noiseFloor > 0.0012
      ? "medium"
      : segmentDensity > 1.1 || noiseRatio > 0.18
        ? "low"
      : noiseRatio > 0.12 || flatness > 0.2
        ? "medium"
        : "low";

  const noiseType = noisePresent
    ? detectNoiseType({
      lowFreqRatio,
      midFreqRatio,
      highFreqRatio,
      flatness,
      speechSegmentCount,
      noiseFloor,
      harmonicity,
      pitchCount: voicedPitchCount,
    })
    : "";

  const qualityPenalty = clamp(
    (noiseSeverity === "none" ? 0 : noiseSeverity === "low" ? 0.12 : noiseSeverity === "medium" ? 0.34 : 0.58) +
      clipRate * 2.2 +
      (lowVolume ? 0.25 : 0) +
      (pauseRatio > 0.65 ? 0.15 : 0),
    0,
    1,
  );

  const overlapPresent =
    segmentDensity > 1.2 ||
    (noisePresent && speechSegmentCount > 120) ||
    (harmonicity > 0.08 && pitchStd > 24 && meanSpeechZcr > 0.025);

  const quality = deriveQuality({
    noiseSeverity,
    clippingRate: clipRate,
    noiseRatio,
    signalToNoise,
    lowVolume,
  });

  const tone = classifyTone({
    speechEnergy,
    noiseRatio,
    pitchMean,
    pitchStd,
    zcrSpeech: meanSpeechZcr,
    pauseRatio,
    clippingRate: clipRate,
    segmentDensity,
    longSilence: longSilencePresent,
    qualityPenalty,
  });

  const confidence = clamp(
    tone.confidenceHint +
      (pitchConfidenceMean > 0.35 ? 0.06 : -0.05) +
      (speechFrames.length > 8 ? 0.05 : -0.04) +
      (noisePresent ? -0.04 : 0.05) +
      (quality === "clear" ? 0.03 : 0),
    0.32,
    0.95,
  );

  const emotionIntensity = TONE_LABELS.includes(tone.tone)
    ? tone.intensity
    : "low";

  return {
    result: {
      emotional_tone: tone.tone,
      emotional_intensity: emotionIntensity,
      background_noise_present: noisePresent,
      background_noise_type: noiseType,
      background_noise_severity: noiseSeverity,
      audio_quality: quality,
      speaker_overlap_present: Boolean(overlapPresent),
      long_silence_present: Boolean(longSilencePresent),
      confidence: Number(confidence.toFixed(2)),
    },
    metrics: {
      frames: frames.length,
      speechFrames: speechFrames.length,
      silenceFrames: silenceFrames.length,
      speechRatio: speechFrames.length / Math.max(1, frames.length),
      silenceRatio,
      audioDurationSeconds,
      maxSilenceSeconds,
      segmentDensity,
      speechEnergy,
      noiseFloor,
      signalToNoise,
      pitchMean,
      pitchStd,
      pitchConfidenceMean,
      meanSpeechZcr,
      clipRate,
      lowFreqRatio,
      midFreqRatio,
      highFreqRatio,
      flatness,
      harmonicity,
      transientRate,
      pauseRatio,
      longSilencePresent,
      speechSegmentCount,
    },
  };
}

async function decodeAudioBuffer(file) {
  const context = new (window.AudioContext || window.webkitAudioContext)();
  const arrayBuffer = await readArrayBufferFromFile(file);
  const decoded = await context.decodeAudioData(arrayBuffer.slice(0));
  await context.close();
  return decoded;
}

function toMonoArray(audioBuffer) {
  const channelCount = audioBuffer.numberOfChannels;
  const mono = new Float32Array(audioBuffer.length);
  for (let channel = 0; channel < channelCount; channel += 1) {
    const data = audioBuffer.getChannelData(channel);
    for (let i = 0; i < data.length; i += 1) {
      mono[i] += data[i] / channelCount;
    }
  }
  return mono;
}

function resampleAudio(samples, sourceRate, targetRate) {
  if (sourceRate === targetRate) {
    return samples;
  }

  const targetLength = Math.max(1, Math.round((samples.length * targetRate) / sourceRate));
  const output = new Float32Array(targetLength);
  const ratio = sourceRate / targetRate;

  for (let index = 0; index < targetLength; index += 1) {
    const position = index * ratio;
    const leftIndex = Math.floor(position);
    const rightIndex = Math.min(samples.length - 1, leftIndex + 1);
    const fraction = position - leftIndex;
    output[index] = samples[leftIndex] * (1 - fraction) + samples[rightIndex] * fraction;
  }

  return output;
}

function encodePcm16Base64(samples) {
  const bytes = new Uint8Array(samples.length * 2);
  const view = new DataView(bytes.buffer);

  for (let index = 0; index < samples.length; index += 1) {
    const value = Math.max(-1, Math.min(1, samples[index]));
    view.setInt16(index * 2, Math.round(value * 32767), true);
  }

  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length)));
  }
  return btoa(binary);
}

function selectToneModelSegments(samples, sampleRate) {
  const segmentLength = Math.max(1, Math.round(sampleRate * TONE_MODEL_SEGMENT_SECONDS));
  const candidates = [];

  for (let start = 0; start < samples.length; start += segmentLength) {
    const segment = samples.subarray(start, Math.min(samples.length, start + segmentLength));
    if (segment.length < sampleRate) {
      continue;
    }
    candidates.push({
      start,
      samples: segment,
      energy: computeRms(segment),
    });
  }

  const audible = candidates.filter((candidate) => candidate.energy >= 0.004);
  const selectionPool = audible.length ? audible : candidates;
  return selectionPool
    .sort((left, right) => right.energy - left.energy)
    .slice(0, TONE_MODEL_MAX_SEGMENTS)
    .sort((left, right) => left.start - right.start);
}

function isToneModelResponse(payload) {
  return (
    payload &&
    payload.labels &&
    ["neu", "ang", "hap", "sad"].every((label) => typeof payload.labels[label] === "number")
  );
}

async function requestToneModel(segment, sampleRate) {
  const response = await fetch(TONE_MODEL_ENDPOINT, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      sample_rate: sampleRate,
      pcm16_base64: encodePcm16Base64(segment),
      duration_seconds: Number((segment.length / sampleRate).toFixed(2)),
    }),
  });

  const payload = await readJsonResponse(response);
  if (response.status === 503) {
    state.toneModel.status = "unavailable";
    state.toneModel.reason = payload?.error || payload?.detail || "Pretrained tone model is unavailable.";
    return null;
  }
  if (!response.ok || !isToneModelResponse(payload)) {
    throw new Error(payload?.error || payload?.detail || "Pretrained tone model returned an invalid response.");
  }

  state.toneModel.status = "active";
  return payload;
}

async function analyzePretrainedTone(samples, sampleRate) {
  if (state.toneModel.status === "unavailable") {
    return null;
  }

  const resampled = resampleAudio(samples, sampleRate, TONE_MODEL_SAMPLE_RATE);
  const segments = selectToneModelSegments(resampled, TONE_MODEL_SAMPLE_RATE);
  if (!segments.length) {
    return null;
  }

  const combined = { neu: 0, ang: 0, hap: 0, sad: 0 };
  let totalWeight = 0;
  let modelName = "";

  for (const segment of segments) {
    const prediction = await requestToneModel(segment.samples, TONE_MODEL_SAMPLE_RATE);
    if (!prediction) {
      return null;
    }
    const weight = Math.max(0.01, segment.energy * segment.samples.length);
    totalWeight += weight;
    modelName = prediction.model || modelName;
    for (const label of Object.keys(combined)) {
      combined[label] += prediction.labels[label] * weight;
    }
  }

  for (const label of Object.keys(combined)) {
    combined[label] /= Math.max(totalWeight, 1e-12);
  }
  const ordered = Object.entries(combined).sort((left, right) => right[1] - left[1]);

  return {
    model: modelName,
    labels: combined,
    confidence: ordered[0][1],
    margin: ordered[0][1] - ordered[1][1],
    segments: segments.length,
  };
}

function fuseTonePrediction(baseline, metrics, modelEvidence) {
  if (!modelEvidence) {
    return baseline;
  }

  const { neu, ang, hap, sad } = modelEvidence.labels;
  const reliable = modelEvidence.confidence >= 0.58 && modelEvidence.margin >= 0.1;
  const elevatedStress = metrics.speechEnergy > 0.055 || metrics.pitchStd > 42 || metrics.clipRate > 0.012;
  let tone = baseline.emotional_tone;
  let intensity = baseline.emotional_intensity;

  if (reliable && hap > neu && hap > ang && hap > sad) {
    tone = "satisfied";
    intensity = modelEvidence.confidence > 0.82 ? "high" : "medium";
  } else if (reliable && ang > neu && ang > hap && ang > sad) {
    tone = modelEvidence.confidence > 0.75 && elevatedStress ? "upset" : "frustrated";
    intensity = tone === "upset" ? "high" : "medium";
  } else if (reliable && neu > ang && neu > hap && neu > sad && baseline.emotional_tone !== "distressed") {
    tone = "neutral";
    intensity = baseline.emotional_intensity === "high" ? "medium" : baseline.emotional_intensity;
  } else if (reliable && sad > neu && sad > ang && sad > hap && baseline.emotional_tone === "distressed") {
    tone = "distressed";
    intensity = "high";
  }

  const modelSupport =
    tone === "satisfied"
      ? hap
      : tone === "neutral"
        ? neu
        : tone === "distressed"
          ? Math.max(sad, ang * 0.65)
          : ang;
  const confidence = clamp(
    baseline.confidence * 0.66 + modelEvidence.confidence * 0.22 + (modelSupport >= 0.5 ? 0.07 : -0.05),
    0.32,
    0.95,
  );

  return {
    ...baseline,
    emotional_tone: tone,
    emotional_intensity: intensity,
    confidence: Number(confidence.toFixed(2)),
  };
}

function parseGroundTruthJson(text) {
  if (!text || !String(text).trim()) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    return null;
  }
}

function comparePredictions(predicted, truth) {
  if (!truth) {
    return { status: "missing_truth" };
  }
  const comparisons = {};
  for (const key of Object.keys(predicted)) {
    if (key === "confidence") {
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(truth, key)) {
      comparisons[key] = predicted[key] === truth[key];
    }
  }
  return comparisons;
}

function summarizeByTone(results) {
  const counts = new Map(TONE_LABELS.map((tone) => [tone, 0]));
  for (const row of results) {
    if (row.status === "ok") {
      counts.set(row.prediction.emotional_tone, (counts.get(row.prediction.emotional_tone) || 0) + 1);
    }
  }
  return counts;
}

function renderSummary(results) {
  const successCount = results.filter((row) => row.status === "ok").length;
  const errorCount = results.filter((row) => row.status !== "ok").length;
  const noisePresentCount = results.filter((row) => row.status === "ok" && row.prediction.background_noise_present).length;
  const severeCount = results.filter((row) => row.status === "ok" && row.prediction.audio_quality === "severely_impaired").length;
  const overlapCount = results.filter((row) => row.status === "ok" && row.prediction.speaker_overlap_present).length;

  const cards = [
    ["Processed", String(successCount)],
    ["Errors", String(errorCount)],
    ["Noise detected", String(noisePresentCount)],
    ["Severely impaired", String(severeCount)],
    ["Overlap flagged", String(overlapCount)],
  ];

  dom.summaryCards.innerHTML = cards
    .map(
      ([label, value]) => `
        <div class="summary-card">
          <label>${label}</label>
          <strong>${value}</strong>
        </div>
      `,
    )
    .join("");
}

function renderResults(results) {
  if (!results.length) {
    dom.resultsBody.innerHTML = '<tr><td colspan="10" class="empty-state">No results yet.</td></tr>';
    return;
  }

  dom.resultsBody.innerHTML = results
    .map((row) => {
      const statusClass = row.status === "ok" ? "ok" : row.status === "warning" ? "warn" : "err";
      const statusText = row.status === "ok" ? "Complete" : row.status === "warning" ? "Warning" : "Error";
      const prediction = row.prediction || {};
      return `
        <tr>
          <td><span class="cell-label">Filename</span><span class="cell-value">${row.name}</span></td>
          <td><span class="cell-label">Tone</span><span class="cell-value"><span class="tone-pill">${prediction.emotional_tone || "-"}</span></span></td>
          <td><span class="cell-label">Intensity</span><span class="cell-value">${prediction.emotional_intensity || "-"}</span></td>
          <td><span class="cell-label">Noise</span><span class="cell-value">${prediction.background_noise_present === undefined ? "-" : String(prediction.background_noise_present)}</span></td>
          <td><span class="cell-label">Noise type</span><span class="cell-value">${prediction.background_noise_type || ""}</span></td>
          <td><span class="cell-label">Quality</span><span class="cell-value">${prediction.audio_quality || "-"}</span></td>
          <td><span class="cell-label">Overlap</span><span class="cell-value">${prediction.speaker_overlap_present === undefined ? "-" : String(prediction.speaker_overlap_present)}</span></td>
          <td><span class="cell-label">Silence</span><span class="cell-value">${prediction.long_silence_present === undefined ? "-" : String(prediction.long_silence_present)}</span></td>
          <td><span class="cell-label">Confidence</span><span class="cell-value">${typeof prediction.confidence === "number" ? prediction.confidence.toFixed(2) : "-"}</span></td>
          <td><span class="cell-label">Status</span><span class="cell-value"><span class="status-pill ${statusClass}">${statusText}${row.error ? `: ${row.error}` : ""}</span></span></td>
        </tr>
      `;
    })
    .join("");
}

function renderValidation(results) {
  const scored = results.filter((row) => row.status === "ok" && row.truth);
  if (!scored.length) {
    dom.validationSummary.innerHTML = `
      <div class="summary-card">
        <label>Validation</label>
        <strong>No ground truth in this batch</strong>
      </div>
    `;
    dom.confusionMatrix.innerHTML = '<div class="empty-state">Upload a labeled batch to compute tone confusion and field accuracy.</div>';
    return;
  }

  const fields = [
    "emotional_tone",
    "emotional_intensity",
    "background_noise_present",
    "background_noise_severity",
    "audio_quality",
    "speaker_overlap_present",
    "long_silence_present",
  ];

  const fieldAccuracy = Object.fromEntries(fields.map((field) => [field, { correct: 0, total: 0 }]));
  const toneMatrix = Object.fromEntries(TONE_LABELS.map((truth) => [truth, Object.fromEntries(TONE_LABELS.map((pred) => [pred, 0]))]));
  const toneCounts = Object.fromEntries(TONE_LABELS.map((tone) => [tone, { tp: 0, fp: 0, fn: 0 }]));

  for (const row of scored) {
    const truth = row.truth;
    const predicted = row.prediction;
    for (const field of fields) {
      if (truth[field] !== undefined) {
        fieldAccuracy[field].total += 1;
        if (truth[field] === predicted[field]) {
          fieldAccuracy[field].correct += 1;
        }
      }
    }

    if (truth.emotional_tone && predicted.emotional_tone) {
      toneMatrix[truth.emotional_tone][predicted.emotional_tone] += 1;
    }
  }

  for (const tone of TONE_LABELS) {
    for (const truthTone of TONE_LABELS) {
      for (const predTone of TONE_LABELS) {
        const count = toneMatrix[truthTone][predTone];
        if (predTone === tone && truthTone === tone) {
          toneCounts[tone].tp += count;
        } else if (predTone === tone && truthTone !== tone) {
          toneCounts[tone].fp += count;
        } else if (predTone !== tone && truthTone === tone) {
          toneCounts[tone].fn += count;
        }
      }
    }
  }

  const macroF1Values = TONE_LABELS.map((tone) => {
    const { tp, fp, fn } = toneCounts[tone];
    const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
    const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
    return precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
  });
  const macroF1 = mean(macroF1Values);
  const observedToneLabels = TONE_LABELS.filter((tone) => (toneMatrix[tone] || {}).neutral !== undefined)
    .filter((tone) => TONE_LABELS.some((predTone) => toneMatrix[tone][predTone] > 0));
  const observedMacroF1 = observedToneLabels.length
    ? mean(observedToneLabels.map((tone) => {
        const { tp, fp, fn } = toneCounts[tone];
        const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
        const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
        return precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
      }))
    : 0;

  const summaryCards = [
    ["Rows scored", String(scored.length)],
    ["Tone macro F1 (observed)", observedMacroF1.toFixed(3)],
    ["Tone macro F1 (all)", macroF1.toFixed(3)],
    ["Tone accuracy", (fieldAccuracy.emotional_tone.correct / Math.max(1, fieldAccuracy.emotional_tone.total)).toFixed(3)],
    ["Noise accuracy", (fieldAccuracy.background_noise_present.correct / Math.max(1, fieldAccuracy.background_noise_present.total)).toFixed(3)],
    ["Quality accuracy", (fieldAccuracy.audio_quality.correct / Math.max(1, fieldAccuracy.audio_quality.total)).toFixed(3)],
  ];

  dom.validationSummary.innerHTML = summaryCards
    .map(
      ([label, value]) => `
        <div class="summary-card">
          <label>${label}</label>
          <strong>${value}</strong>
        </div>
      `,
    )
    .join("");

  const headerRow = `
    <tr>
      <th>Truth \\ Pred</th>
      ${TONE_LABELS.map((tone) => `<th>${tone}</th>`).join("")}
    </tr>
  `;
  const matrixRows = TONE_LABELS.map(
    (truthTone) => `
      <tr>
        <td>${truthTone}</td>
        ${TONE_LABELS.map((predTone) => `<td>${toneMatrix[truthTone][predTone]}</td>`).join("")}
      </tr>
    `,
  ).join("");

  dom.confusionMatrix.innerHTML = `
    <table class="matrix-grid">
      <thead>${headerRow}</thead>
      <tbody>${matrixRows}</tbody>
    </table>
  `;
}

function renderOperationalSummary() {
  const timing = state.analysisTiming;
  if (!timing) {
    dom.opsSummary.innerHTML = `
      <div class="summary-card">
        <label>Runtime</label>
        <strong>Not measured yet</strong>
      </div>
    `;
    return;
  }

  const audioMinutes = timing.audioSecondsTotal / 60;
  const wallSeconds = timing.wallTimeMs / 1000;
  const secondsPerAudioMinute = audioMinutes > 0 ? wallSeconds / audioMinutes : 0;
  const realtimeFactor = wallSeconds > 0 ? timing.audioSecondsTotal / wallSeconds : 0;
  const costPerMinute = 0;

  const cards = [
    ["Tone engine", state.toneModel.status === "active" ? "Hybrid pretrained model" : "Acoustic fallback"],
    ["Audio minutes", audioMinutes.toFixed(2)],
    ["Wall time", `${wallSeconds.toFixed(2)} s`],
    ["Seconds per audio minute", secondsPerAudioMinute.toFixed(2)],
    ["Throughput", `${realtimeFactor.toFixed(1)}x real time`],
    ["Estimated cost/min", `$${costPerMinute.toFixed(4)}`],
  ];

  dom.opsSummary.innerHTML = cards
    .map(
      ([label, value]) => `
        <div class="summary-card">
          <label>${label}</label>
          <strong>${value}</strong>
        </div>
      `,
    )
    .join("");
}

function buildDownloads(results) {
  for (const url of state.downloadUrls) {
    URL.revokeObjectURL(url);
  }
  const predictionRows = results.filter((row) => row.status === "ok");
  const csvLines = ["name,result_json"];
  const jsonRows = [];

  for (const row of predictionRows) {
    const resultJson = JSON.stringify(row.prediction);
    csvLines.push(`${csvEscape(row.name)},${csvEscape(resultJson)}`);
    jsonRows.push({
      name: row.name,
      result_json: row.prediction,
    });
  }

  const diagnostics = {
    generated_at: new Date().toISOString(),
    total_files: results.length,
    successful_files: predictionRows.length,
    failed_files: results.filter((row) => row.status !== "ok").map((row) => ({
      name: row.name,
      error: row.error,
    })),
    results: results.map((row) => ({
      name: row.name,
      status: row.status,
      error: row.error || "",
      prediction: row.prediction || null,
      truth: row.truth || null,
    })),
  };

  state.report = {
    json: JSON.stringify(jsonRows, null, 2),
    csv: `${csvLines.join("\n")}\n`,
    diagnostics: JSON.stringify(diagnostics, null, 2),
  };
  dom.debugDump.textContent = JSON.stringify(
    results.map((row) => ({
      name: row.name,
      prediction: row.prediction,
      truth: row.truth,
      metrics: row.metrics,
      status: row.status,
      error: row.error || "",
    })),
    null,
    2,
  );
  const jsonUrl = URL.createObjectURL(new Blob([state.report.json], { type: "application/json" }));
  const csvUrl = URL.createObjectURL(new Blob([state.report.csv], { type: "text/csv" }));
  state.downloadUrls = [jsonUrl, csvUrl];
  syncDownloadLinks(jsonUrl, csvUrl, true);
}

function downloadText(filename, text, type = "application/json") {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function attachDownloadHandlers() {
  return;
}

function collectDroppedFiles(event) {
  return Array.from(event.dataTransfer?.files || []);
}

async function collectDirectoryEntry(entry) {
  const files = [];
  const reader = entry.createReader();

  async function readBatch() {
    const entries = await new Promise((resolve, reject) => {
      reader.readEntries(resolve, reject);
    });
    if (!entries.length) {
      return;
    }
    for (const child of entries) {
      if (child.isFile) {
        const file = await new Promise((resolve, reject) => child.file(resolve, reject));
        files.push(file);
      } else if (child.isDirectory) {
        files.push(...(await collectDirectoryEntry(child)));
      }
    }
    await readBatch();
  }

  await readBatch();
  return files;
}

async function loadFilesFromInputs() {
  const manualFiles = [
    ...Array.from(dom.singleAudioInput.files || []),
    ...Array.from(dom.folderInput.files || []),
    ...Array.from(dom.zipInput.files || []),
    ...Array.from(dom.manifestInput.files || []),
  ];

  if (!manualFiles.length) {
    return [];
  }
  return manualFiles;
}

function manifestToMap(rows) {
  const map = new Map();
  for (const row of rows) {
    if (!row.name) {
      continue;
    }
    map.set(normalizeName(row.name).toLowerCase(), row);
  }
  return map;
}

async function parseManifestFromFile(file) {
  if (!file || fileExtension(file.name) !== ".csv") {
    return [];
  }
  const text = await readFileText(file);
  const rows = parseCsv(text);
  if (!rows.length) {
    return [];
  }
  const [header, ...dataRows] = rows;
  const nameIndex = header.findIndex((column) => column.trim().toLowerCase() === "name");
  const resultIndex = header.findIndex((column) => column.trim().toLowerCase() === "result_json");
  if (nameIndex < 0) {
    throw new Error("Manifest CSV must contain a name column");
  }
  return dataRows.map((row) => ({
    name: row[nameIndex] || "",
    result_json: resultIndex >= 0 ? row[resultIndex] || "" : "",
  }));
}

async function getBatchEntries() {
  const manualFiles = await loadFilesFromInputs();
  const [zipFile] = manualFiles.filter((file) => fileExtension(file.name) === ".zip");
  const manifestFile = manualFiles.find((file) => fileExtension(file.name) === ".csv");
  let batchEntries = [];
  let manifestRows = [];

  if (zipFile) {
    batchEntries = await extractZipEntries(zipFile);
    if (manifestFile) {
      manifestRows = await parseManifestFromFile(manifestFile);
    } else {
      const zipManifestEntry = batchEntries.find((entry) => fileExtension(entry.name) === ".csv");
      manifestRows = zipManifestEntry
        ? await parseManifestFromFile(new File([zipManifestEntry.data], zipManifestEntry.name, { type: "text/csv" }))
        : [];
    }
  } else {
    batchEntries = manualFiles
      .filter((file) => fileExtension(file.name) !== ".csv")
      .map((file) => ({
        name: normalizeName(file.name),
        path: file.name,
        extension: fileExtension(file.name),
        file,
      }));
    manifestRows = await parseManifestFromFile(manifestFile);
  }

  const audioEntries = zipFile
    ? batchEntries.filter((entry) => SUPPORTED_AUDIO_EXTENSIONS.has(entry.extension)).map((entry) => ({
        name: entry.name,
        path: entry.path,
        extension: entry.extension,
        file: new File([entry.data], entry.name, { type: "application/octet-stream" }),
      }))
    : batchEntries.filter((entry) => isAudioFile(entry.file));

  return { audioEntries, manifestRows, sourceFiles: manualFiles };
}

async function analyzeBatch() {
  if (state.processing) {
    return;
  }
  state.processing = true;
  dom.analyzeButton.disabled = true;
  syncDownloadLinks();
  state.toneModel = { status: "unknown", reason: "" };
  setProgress("Preparing batch", 0.02);
  setStatus("Preparing batch", "info");
  setMessage("Reading uploaded files and validating the manifest...");
  const analysisStart = Date.now();
  let totalAudioSeconds = 0;

  try {
    const { audioEntries, manifestRows, sourceFiles } = await getBatchEntries();
    state.sourceFiles = sourceFiles;
    state.audioFiles = audioEntries;
    state.manifestRows = manifestRows;
    state.manifestMap = manifestToMap(manifestRows);
    setCounters();

    if (!audioEntries.length) {
      throw new Error("No supported audio files found. Please upload a folder, ZIP, or single audio clip.");
    }

    const results = [];
    const warnings = [];
    const manifestNames = new Set(manifestRows.map((row) => normalizeName(row.name).toLowerCase()));
    const audioNames = new Set(audioEntries.map((entry) => normalizeName(entry.name).toLowerCase()));

    for (const name of manifestNames) {
      if (!audioNames.has(name)) {
        warnings.push(`Manifest row has no matching audio file: ${name}`);
      }
    }

    for (const name of audioNames) {
      if (!manifestNames.has(name)) {
        warnings.push(`Audio file is missing a manifest row: ${name}`);
      }
    }

    if (warnings.length) {
      setMessage(
        `<div class="warning">${warnings.map((warning) => `- ${warning}`).join("<br />")}</div>`,
      );
    } else {
      setMessage("Manifest validation passed. Processing audio clips now.");
    }

    const total = audioEntries.length;
    for (let index = 0; index < total; index += 1) {
      const entry = audioEntries[index];
      const progress = 0.05 + (index / Math.max(1, total)) * 0.85;
      setProgress(`Analyzing ${entry.name}`, progress);
      setStatus(`Analyzing ${entry.name}`, "info");

      const manifestRow = state.manifestMap.get(normalizeName(entry.name).toLowerCase());
      try {
        const audioBuffer = await decodeAudioBuffer(entry.file);
        totalAudioSeconds += audioBuffer.duration || 0;
        const monoSamples = toMonoArray(audioBuffer);
        const { result: baselineResult, metrics } = analyzeSamples(monoSamples, audioBuffer.sampleRate);
        const modelEvidence = await analyzePretrainedTone(monoSamples, audioBuffer.sampleRate);
        const result = fuseTonePrediction(baselineResult, metrics, modelEvidence);
        metrics.pretrainedTone = modelEvidence || {
          available: false,
          reason: state.toneModel.reason || "Pretrained tone model was not used.",
        };
        const truth = manifestRow ? parseGroundTruthJson(manifestRow.result_json) : null;
        results.push({
          name: normalizeName(entry.name),
          status: "ok",
          prediction: result,
          metrics,
          truth,
          source: entry.path || entry.name,
        });
      } catch (error) {
        results.push({
          name: normalizeName(entry.name),
          status: "error",
          error: error instanceof Error ? error.message : String(error),
          prediction: null,
          metrics: null,
          truth: manifestRow ? parseGroundTruthJson(manifestRow.result_json) : null,
          source: entry.path || entry.name,
        });
      }
    }

    state.results = results;
    state.analysisTiming = {
      wallTimeMs: Date.now() - analysisStart,
      audioSecondsTotal: totalAudioSeconds,
    };
    setProgress("Finalizing report", 0.97);
    renderSummary(results);
    renderResults(results);
    renderValidation(results);
    renderOperationalSummary();
    buildDownloads(results);
    setCounters();

    const okCount = results.filter((row) => row.status === "ok").length;
    const errorCount = results.filter((row) => row.status !== "ok").length;
    const toneEngineMessage =
      state.toneModel.status === "active"
        ? " Pretrained tone model blended with acoustic checks."
        : " Pretrained tone model was unavailable, so acoustic baseline results were used.";
    setMessage(
      `
        <div class="success">Analysis complete. ${okCount} file(s) processed successfully.${toneEngineMessage}</div>
        ${errorCount ? `<div class="error">${errorCount} file(s) failed and were kept out of the downloadable prediction files.</div>` : ""}
      `,
    );
    setStatus("Analysis complete", "success");
    setProgress("Done", 1);
    scrollToResultsPanel();
  } catch (error) {
    setStatus("Analysis failed", "error");
    setMessage(
      `<div class="error">${error instanceof Error ? error.message : String(error)}</div>`,
    );
    setProgress("Failed", 0);
    state.analysisTiming = {
      wallTimeMs: Date.now() - analysisStart,
      audioSecondsTotal: totalAudioSeconds,
    };
    renderOperationalSummary();
  } finally {
    state.processing = false;
    dom.analyzeButton.disabled = false;
  }
}

function hookInputs() {
  const resetOtherInputs = (source) => {
    if (source !== dom.singleAudioInput) dom.singleAudioInput.value = "";
    if (source !== dom.folderInput) dom.folderInput.value = "";
    if (source !== dom.zipInput) dom.zipInput.value = "";
  };

  dom.singleAudioInput.addEventListener("change", () => {
    resetOtherInputs(dom.singleAudioInput);
    setMessage("Single audio selected. The app will process it as a one-item batch when you run analysis.");
  });

  dom.folderInput.addEventListener("change", () => {
    resetOtherInputs(dom.folderInput);
    setMessage("Folder selected. The app will auto-detect audio files and labels.csv when you run analysis.");
  });

  dom.zipInput.addEventListener("change", () => {
    resetOtherInputs(dom.zipInput);
    setMessage("ZIP selected. The app will extract supported files in the browser during analysis.");
  });

  dom.manifestInput.addEventListener("change", () => {
    setMessage("Manifest selected. It will be paired with the uploaded batch on analysis.");
  });

  dom.analyzeButton.addEventListener("click", analyzeBatch);

  dom.clearButton.addEventListener("click", () => {
    dom.singleAudioInput.value = "";
    dom.folderInput.value = "";
    dom.zipInput.value = "";
    dom.manifestInput.value = "";
    clearState();
  });

  dom.dropZone.addEventListener("dragover", (event) => {
    event.preventDefault();
    dom.dropZone.classList.add("dragging");
  });

  dom.dropZone.addEventListener("dragleave", () => {
    dom.dropZone.classList.remove("dragging");
  });

  dom.dropZone.addEventListener("drop", async (event) => {
    event.preventDefault();
    dom.dropZone.classList.remove("dragging");
    const files = collectDroppedFiles(event);
    if (!files.length) {
      return;
    }

    const dataTransfer = new DataTransfer();
    for (const file of files) {
      dataTransfer.items.add(file);
    }
    if (files.length === 1 && isAudioFile(files[0])) {
      dom.singleAudioInput.files = dataTransfer.files;
    } else {
      dom.folderInput.files = dataTransfer.files;
    }
    dom.zipInput.value = "";
    dom.manifestInput.value = "";
    setMessage(
      files.length === 1 && isAudioFile(files[0])
        ? "Dropped one audio file. The single-file input has been populated."
        : `Dropped ${files.length} file(s). The folder input has been populated.`,
    );
  });
}

function applyInitialMessage() {
  setMessage(
    [
      "Start with the three labeled sample calls if you have them, or test a single audio file from the one-item upload path.",
      "The app validates the manifest, analyzes each audio file independently, and keeps failures isolated to the affected row.",
      "If a ZIP uses standard deflate compression, it is unpacked in-browser without extra dependencies.",
    ]
      .map((line) => `<div class="success">${line}</div>`)
      .join(""),
  );
}

void (async () => {
  await initializeAuth();
  if (dom.appRoot) {
    attachDownloadHandlers();
    hookInputs();
    applyInitialMessage();
    clearState(true);
  }
})();
