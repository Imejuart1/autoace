import os from "node:os";
import path from "node:path";

import { LogitsProcessorList, pipeline, env } from "@huggingface/transformers";

import {
  languageNameFromCode,
  transcriptionRouteForLanguage,
  WhisperLanguageLogitsProcessor,
} from "./language-routing.mjs";

const MODEL_ID = process.env.AUTOACE_TONE_MODEL || "onnx-community/Speech-Emotion-Classification-ONNX";
const MODEL_DTYPE = process.env.AUTOACE_TONE_MODEL_DTYPE || "q4";
const ENGLISH_ASR_MODEL_ID =
  process.env.AUTOACE_ENGLISH_ASR_MODEL ||
  process.env.AUTOACE_ASR_MODEL ||
  "onnx-community/whisper-tiny.en";
const MULTILINGUAL_ASR_MODEL_ID =
  process.env.AUTOACE_MULTILINGUAL_ASR_MODEL || "onnx-community/whisper-tiny";
const ASR_MODEL_DTYPE = process.env.AUTOACE_ASR_MODEL_DTYPE || "q4";
const ASR_ENABLED = process.env.AUTOACE_ASR_ENABLED !== "0";
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
let englishTranscriberPromise;
let multilingualTranscriberPromise;
let inferenceQueue = Promise.resolve();

async function disposePipeline(pipelinePromise) {
  if (!pipelinePromise) {
    return;
  }
  try {
    const instance = await pipelinePromise;
    await instance?.dispose?.();
  } catch {
    // Best-effort cleanup: a failed model load should not block the next request.
  }
}

export async function resetToneModels() {
  const classifier = classifierPromise;
  const englishTranscriber = englishTranscriberPromise;
  const multilingualTranscriber = multilingualTranscriberPromise;

  classifierPromise = undefined;
  englishTranscriberPromise = undefined;
  multilingualTranscriberPromise = undefined;

  await Promise.allSettled([
    disposePipeline(classifier),
    disposePipeline(englishTranscriber),
    disposePipeline(multilingualTranscriber),
  ]);

  globalThis.gc?.();
}

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

async function loadEnglishTranscriber() {
  if (!ASR_ENABLED) {
    return null;
  }
  if (!englishTranscriberPromise) {
    englishTranscriberPromise = pipeline("automatic-speech-recognition", ENGLISH_ASR_MODEL_ID, {
      cache_dir: CACHE_DIR,
      device: "cpu",
      dtype: ASR_MODEL_DTYPE,
    });
  }
  return englishTranscriberPromise;
}

async function loadMultilingualTranscriber() {
  if (!ASR_ENABLED) {
    return null;
  }
  if (!multilingualTranscriberPromise) {
    multilingualTranscriberPromise = pipeline(
      "automatic-speech-recognition",
      MULTILINGUAL_ASR_MODEL_ID,
      {
        cache_dir: CACHE_DIR,
        device: "cpu",
        dtype: ASR_MODEL_DTYPE,
      },
    );
  }
  return multilingualTranscriberPromise;
}

async function releaseMultilingualTranscriber() {
  if (!multilingualTranscriberPromise) {
    return;
  }
  const transcriber = await multilingualTranscriberPromise;
  multilingualTranscriberPromise = undefined;
  await transcriber?.dispose?.();
}

function normalizeLanguageHint(languageHint) {
  const code = String(languageHint || "").trim().toLowerCase();
  return /^[a-z]{2,3}$/.test(code) ? code : "";
}

async function detectLanguage(audio, transcriber) {
  const generationConfig = transcriber.model.generation_config || {};
  const processor = new WhisperLanguageLogitsProcessor(generationConfig.lang_to_id);
  const processors = new LogitsProcessorList();
  processors.push(processor);
  const features = await transcriber.processor(audio);

  await transcriber.model.generate({
    inputs: features.input_features,
    decoder_input_ids: [[generationConfig.decoder_start_token_id]],
    logits_processor: processors,
    max_new_tokens: 1,
  });

  if (!processor.prediction?.code) {
    throw new Error("Whisper could not identify the spoken language.");
  }
  return processor.prediction;
}

async function transcribeAudio(audio, languageHint = "") {
  try {
    if (!ASR_ENABLED) {
      return { available: false, text: "", reason: "Local transcription is disabled." };
    }

    let detectedLanguage = null;
    let languageCode = "";
    let multilingualTranscriber = null;

    if (languageHint) {
      languageCode = normalizeLanguageHint(languageHint);
    }

    if (!languageCode) {
      multilingualTranscriber ||= await loadMultilingualTranscriber();
      if (!multilingualTranscriber) {
        return { available: false, text: "", reason: "Local transcription is disabled." };
      }
      detectedLanguage = await detectLanguage(audio, multilingualTranscriber);
      languageCode = detectedLanguage.code;
    }

    const route = transcriptionRouteForLanguage(languageCode);
    if (route === "multilingual") {
      multilingualTranscriber ||= await loadMultilingualTranscriber();
    } else if (multilingualTranscriber) {
      await releaseMultilingualTranscriber();
      multilingualTranscriber = null;
    }
    const transcriber =
      route === "english" ? await loadEnglishTranscriber() : multilingualTranscriber;
    const transcription =
      route === "english"
        ? await transcriber(audio)
        : await transcriber(audio, { language: languageCode, task: "translate" });

    return {
      available: true,
      text: String(transcription?.text || "").trim(),
      model: route === "english" ? ENGLISH_ASR_MODEL_ID : MULTILINGUAL_ASR_MODEL_ID,
      route,
      languageCode,
      languageName: languageNameFromCode(languageCode),
      languageConfidence: detectedLanguage?.confidence ?? null,
      translatedToEnglish: route === "multilingual",
    };
  } catch (error) {
    return {
      available: false,
      text: "",
      reason: error instanceof Error ? error.message : "Local transcription failed.",
    };
  }
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
    englishAsrModel: ASR_ENABLED ? ENGLISH_ASR_MODEL_ID : null,
    multilingualAsrModel: ASR_ENABLED ? MULTILINGUAL_ASR_MODEL_ID : null,
    cacheDir: CACHE_DIR,
    loaded: Boolean(classifierPromise),
    englishTranscriberLoaded: Boolean(englishTranscriberPromise),
    multilingualTranscriberLoaded: Boolean(multilingualTranscriberPromise),
  };
}

async function classifyTonePayload(payload = {}) {
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
  const transcription = await transcribeAudio(audio, payload.language_hint);

  return {
    model: MODEL_ID,
    labels,
    top_label: topLabel,
    confidence: Number(confidence.toFixed(4)),
    transcript: transcription.text,
    transcription_available: transcription.available,
    transcription_model: transcription.model || null,
    transcription_route: transcription.route || null,
    transcription_translated_to_english: Boolean(transcription.translatedToEnglish),
    detected_language_code: transcription.languageCode || null,
    detected_language_name: transcription.languageName || null,
    detected_language_confidence:
      typeof transcription.languageConfidence === "number"
        ? Number(transcription.languageConfidence.toFixed(4))
        : null,
    transcription_reason: transcription.reason || "",
  };
}

async function classifyTonePayloadWithCleanup(payload = {}) {
  try {
    return await classifyTonePayload(payload);
  } finally {
    if (payload.release_after === true) {
      await resetToneModels();
    }
  }
}

export function classifyToneRequest(payload = {}) {
  const request = inferenceQueue.then(() => classifyTonePayloadWithCleanup(payload));
  inferenceQueue = request.catch(() => undefined);
  return request;
}
