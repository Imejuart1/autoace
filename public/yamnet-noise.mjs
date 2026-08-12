import * as ort from "/vendor/ort.min.mjs";

const MODEL_URL = "/models/yamnet.onnx";
const CLASS_MAP_URL = "/models/yamnet_class_map.csv";
const TARGET_SAMPLE_RATE = 16000;
const WINDOW_SECONDS = 6;
const MAX_WINDOWS = 6;
const MIN_WINDOW_SECONDS = 0.975;

ort.env.wasm.wasmPaths = "/vendor/";
ort.env.wasm.numThreads = 1;

let sessionPromise;
let labelsPromise;

function parseCsvLine(line) {
  const cells = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === "," && !quoted) {
      cells.push(cell);
      cell = "";
    } else {
      cell += char;
    }
  }
  cells.push(cell);
  return cells;
}

async function loadLabels() {
  if (!labelsPromise) {
    labelsPromise = fetch(CLASS_MAP_URL)
      .then((response) => {
        if (!response.ok) {
          throw new Error("YAMNet class map could not be loaded.");
        }
        return response.text();
      })
      .then((text) => text.trim().split(/\r?\n/).slice(1).map((line) => parseCsvLine(line)[2] || ""));
  }
  return labelsPromise;
}

async function loadSession() {
  if (!sessionPromise) {
    sessionPromise = ort.InferenceSession.create(MODEL_URL, {
      executionProviders: ["wasm"],
      graphOptimizationLevel: "all",
    });
  }
  return sessionPromise;
}

function resample(samples, sourceRate) {
  if (sourceRate === TARGET_SAMPLE_RATE) {
    return samples;
  }
  const length = Math.max(1, Math.round(samples.length * TARGET_SAMPLE_RATE / sourceRate));
  const output = new Float32Array(length);
  const ratio = sourceRate / TARGET_SAMPLE_RATE;
  for (let index = 0; index < length; index += 1) {
    const position = index * ratio;
    const left = Math.floor(position);
    const right = Math.min(samples.length - 1, left + 1);
    const fraction = position - left;
    output[index] = samples[left] * (1 - fraction) + samples[right] * fraction;
  }
  return output;
}

function selectWindows(samples) {
  const minimumLength = Math.ceil(TARGET_SAMPLE_RATE * MIN_WINDOW_SECONDS);
  if (samples.length < minimumLength) {
    return [];
  }
  const windowLength = TARGET_SAMPLE_RATE * WINDOW_SECONDS;
  if (samples.length <= windowLength * 1.25) {
    return [samples];
  }

  const count = Math.min(MAX_WINDOWS, Math.max(2, Math.ceil(samples.length / windowLength)));
  const maxStart = Math.max(0, samples.length - windowLength);
  return Array.from({ length: count }, (_, index) => {
    const start = count === 1 ? 0 : Math.round(maxStart * index / (count - 1));
    return samples.subarray(start, Math.min(samples.length, start + windowLength));
  });
}

function mapNoiseType(label) {
  const value = String(label || "").toLowerCase();
  if (/^wind$|wind noise \(microphone\)/.test(value)) return "wind";
  if (/television|radio/.test(value)) return "TV";
  if (/typing|computer keyboard/.test(value)) return "keyboard typing";
  if (/hubbub|speech noise|speech babble|^chatter$|^crowd$/.test(value)) return "office chatter";
  if (/traffic noise|roadway noise|motor vehicle|car passing|vehicle|engine/.test(value)) return "road noise";
  if (/music|musical instrument|piano|guitar|violin|orchestra|jingle \(music\)/.test(value)) return "music";
  if (/static|white noise|pink noise|mains hum|distortion|cacophony/.test(value)) return "static";
  if (/mechanical fan|power tool|drill|sawing|hammer|machinery|mechanical/.test(value)) return "mechanical noise";
  if (/siren|alarm|smoke detector/.test(value)) return "alarm or siren";
  if (/dog|bark|cat|meow|bird|animal/.test(value)) return "animal sounds";
  if (/rain|thunder|water|stream|ocean|waves/.test(value)) return "weather or water";
  if (/door|knock|slam|footsteps/.test(value)) return "room activity";
  if (/^noise$|environmental noise/.test(value)) return "background noise";
  return "";
}

function percentile(values, fraction) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))];
}

function summarizeScores(frameScores, labels) {
  const grouped = new Map();
  for (const frame of frameScores) {
    const frameGroups = new Map();
    for (let index = 0; index < Math.min(frame.length, labels.length); index += 1) {
      const type = mapNoiseType(labels[index]);
      if (!type) continue;
      frameGroups.set(type, Math.max(frameGroups.get(type) || 0, frame[index]));
    }
    for (const [type, score] of frameGroups) {
      if (!grouped.has(type)) grouped.set(type, []);
      grouped.get(type).push(score);
    }
  }

  return [...grouped.entries()]
    .map(([type, scores]) => ({
      type,
      confidence: percentile(scores, 0.9),
      meanConfidence: scores.reduce((sum, score) => sum + score, 0) / Math.max(1, scores.length),
      persistence: scores.filter((score) => score >= 0.2).length / Math.max(1, scores.length),
      backgroundActivity: scores.filter((score) => score >= 0.01).length / Math.max(1, scores.length),
    }))
    .sort((left, right) => {
      const leftRank = left.confidence * 0.7 + left.persistence * 0.3;
      const rightRank = right.confidence * 0.7 + right.persistence * 0.3;
      return rightRank - leftRank;
    });
}

export async function analyzeAudioEvents(samples, sampleRate) {
  const startedAt = performance.now();
  try {
    const resampled = resample(samples, sampleRate);
    const windows = selectWindows(resampled);
    if (!windows.length) {
      return { available: false, reason: "Audio is too short for YAMNet." };
    }

    const [session, labels] = await Promise.all([loadSession(), loadLabels()]);
    const frameScores = [];
    for (const window of windows) {
      const output = await session.run({
        waveform: new ort.Tensor("float32", window, [window.length]),
      });
      const scores = output.output_0;
      const classes = scores.dims.at(-1);
      const frames = Math.floor(scores.data.length / classes);
      for (let frameIndex = 0; frameIndex < frames; frameIndex += 1) {
        const offset = frameIndex * classes;
        frameScores.push(scores.data.subarray(offset, offset + classes));
      }
    }

    const candidates = summarizeScores(frameScores, labels);
    return {
      available: true,
      model: "YAMNet AudioSet 521",
      windows: windows.length,
      frames: frameScores.length,
      runtimeMs: Math.round(performance.now() - startedAt),
      candidate: candidates[0] || null,
      candidates: candidates.slice(0, 5),
    };
  } catch (error) {
    return {
      available: false,
      reason: error instanceof Error ? error.message : "YAMNet inference failed.",
      runtimeMs: Math.round(performance.now() - startedAt),
    };
  }
}
