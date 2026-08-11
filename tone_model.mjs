import os from "node:os";
import path from "node:path";

import { pipeline, env } from "@huggingface/transformers";

const MODEL_ID = process.env.AUTOACE_TONE_MODEL || "onnx-community/Speech-Emotion-Classification-ONNX";
const MODEL_DTYPE = process.env.AUTOACE_TONE_MODEL_DTYPE || "q4";
const CACHE_DIR = process.env.AUTOACE_TF_CACHE_DIR || path.join(os.tmpdir(), "autoace-hf-cache");
const MAX_PCM_BYTES = 1_500_000;
const LABELS = ["neu", "ang", "hap", "sad"];
const MODEL_LABEL_WEIGHTS = new Map([
  ["ANG", { ang: 1 }],
  ["CAL", { neu: 1 }],
  ["DIS", { ang: 1 }],
  ["FEA", { sad: 1 }],
  ["HAP", { hap: 1 }],
  ["NEU", { neu: 1 }],
  ["SAD", { sad: 1 }],
  ["SUR", { ang: 0.55, neu: 0.45 }],
]);

env.cacheDir = CACHE_DIR;
env.useBrowserCache = false;
env.useFSCache = true;
env.allowRemoteModels = true;
env.allowLocalModels = true;

let classifierPromise;

function decodePcm16Base64(pcm16Base64) {
  try {
    const raw = Buffer.from(String(pcm16Base64 || ""), "base64");
    if (!raw.length || raw.length > MAX_PCM_BYTES || raw.length % 2) {
      throw new Error("malformed");
    }
    const samples = new Float32Array(raw.length / 2);
    for (let index = 0; index < samples.length; index += 1) {
      samples[index] = raw.readInt16LE(index * 2) / 32768.0;
    }
    return samples;
  } catch {
    throw new Error("pcm16_base64 must be valid base64 PCM audio.");
  }
}

async function loadClassifier() {
  if (!classifierPromise) {
    classifierPromise = pipeline("audio-classification", MODEL_ID, {
      cache_dir: CACHE_DIR,
      device: "cpu",
      dtype: MODEL_DTYPE,
    });
  }
  return classifierPromise;
}

function normalizeScores(predictions) {
  const scores = Object.fromEntries(LABELS.map((label) => [label, 0]));
  for (const item of predictions || []) {
    const rawLabel = String(item?.label || "").trim().toUpperCase();
    const mapped = MODEL_LABEL_WEIGHTS.get(rawLabel);
    if (!mapped) {
      continue;
    }
    const score = Number(item?.score || 0);
    for (const [label, weight] of Object.entries(mapped)) {
      scores[label] += score * weight;
    }
  }

  const total = Object.values(scores).reduce((sum, value) => sum + value, 0);
  if (!(total > 0)) {
    throw new Error("Unexpected emotion model output.");
  }

  for (const label of LABELS) {
    scores[label] = scores[label] / total;
  }

  return scores;
}

export function getToneModelStatus() {
  return {
    model: MODEL_ID,
    cacheDir: CACHE_DIR,
    loaded: Boolean(classifierPromise),
  };
}

export async function classifyToneRequest(payload = {}) {
  const sampleRate = Number(payload.sample_rate);
  const durationSeconds = Number(payload.duration_seconds);

  if (!Number.isFinite(sampleRate) || sampleRate < 8000 || sampleRate > 48000) {
    throw Object.assign(new Error("sample_rate must be between 8000 and 48000."), { statusCode: 400 });
  }
  if (!Number.isFinite(durationSeconds) || durationSeconds < 0 || durationSeconds > 30) {
    throw Object.assign(new Error("duration_seconds must be between 0 and 30."), { statusCode: 400 });
  }
  if (typeof payload.pcm16_base64 !== "string" || !payload.pcm16_base64.trim()) {
    throw Object.assign(new Error("pcm16_base64 is required."), { statusCode: 400 });
  }

  const audio = decodePcm16Base64(payload.pcm16_base64);
  const classifier = await loadClassifier();
  const predictions = await classifier(audio, { top_k: 7, sampling_rate: sampleRate });
  const labels = normalizeScores(predictions);
  const ordered = Object.entries(labels).sort((left, right) => right[1] - left[1]);
  const [topLabel, confidence] = ordered[0];

  return {
    model: MODEL_ID,
    labels,
    top_label: topLabel,
    confidence: Number(confidence.toFixed(4)),
  };
}
