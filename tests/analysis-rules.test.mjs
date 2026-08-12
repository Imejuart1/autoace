import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

import { Tensor } from "@huggingface/transformers";

import {
  applySemanticTone,
  classifyNoiseSeverity,
  classifyTranscriptEmotion,
  detectBackgroundNoise,
  fuseAudioEventNoise,
  hasStrongDistressEvidence,
  scoreCustomerCandidate,
} from "../public/analysis-rules.mjs";
import {
  languageCodeFromToken,
  languageNameFromCode,
  transcriptionRouteForLanguage,
  WhisperLanguageLogitsProcessor,
} from "../language-routing.mjs";
import {
  analyzeMonoOverlap,
  analyzeStereoOverlap,
  summarizeOverlapFrames,
} from "../public/overlap-detection.mjs";
import {
  REQUIRED_PREDICTION_KEYS,
  validatePrediction,
} from "../public/prediction-schema.mjs";

const require = createRequire(import.meta.url);
const { buildCookieHeader, createSessionCookie, verifyPayload } = require("../api/_auth.js");

const sessionToken = createSessionCookie("autoace");
assert.equal(verifyPayload(sessionToken).username, "autoace");
assert.equal(verifyPayload(`${sessionToken}tampered`), null);
assert.match(buildCookieHeader(sessionToken, 60), /HttpOnly/);
assert.match(buildCookieHeader(sessionToken, 60), /SameSite=Lax/);

assert.equal(languageCodeFromToken("<|en|>"), "en");
assert.equal(languageCodeFromToken("<|fr|>"), "fr");
assert.equal(languageCodeFromToken("not-a-language-token"), "");
assert.equal(transcriptionRouteForLanguage("en"), "english");
assert.equal(transcriptionRouteForLanguage("fr"), "multilingual");
assert.match(languageNameFromCode("en"), /English/i);

const languageProcessor = new WhisperLanguageLogitsProcessor({
  "<|en|>": 1,
  "<|fr|>": 2,
});
const languageLogits = new Tensor(
  "float32",
  new Float32Array([9, 1, 4, 8]),
  [1, 4],
);
languageProcessor._call([], languageLogits);
assert.equal(languageProcessor.prediction.code, "fr");
assert.ok(languageProcessor.prediction.confidence > 0.94);
assert.equal(languageLogits.data[0], -Infinity);
assert.equal(languageLogits.data[3], -Infinity);

const validPrediction = {
  emotional_tone: "neutral",
  emotional_intensity: "low",
  background_noise_present: false,
  background_noise_type: "",
  background_noise_severity: "none",
  audio_quality: "clear",
  speaker_overlap_present: false,
  long_silence_present: false,
  confidence: 0.81,
};
assert.deepEqual(Object.keys(validPrediction), REQUIRED_PREDICTION_KEYS);
assert.deepEqual(validatePrediction(validPrediction), []);
assert.ok(
  validatePrediction({
    ...validPrediction,
    background_noise_type: "wind",
  }).some((error) => error.includes("must be empty")),
);
assert.ok(
  validatePrediction({
    ...validPrediction,
    confidence: 1.2,
  }).some((error) => error.includes("0.0 through 1.0")),
);

const providedPredictions = JSON.parse(
  readFileSync(new URL("../PROVIDED_CALL_PREDICTIONS.json", import.meta.url), "utf8"),
);
assert.equal(providedPredictions.length, 3);
for (const row of providedPredictions) {
  assert.match(row.name, /^call_00[1-3]\.ogg$/);
  assert.deepEqual(Object.keys(row.result_json), REQUIRED_PREDICTION_KEYS);
  assert.deepEqual(validatePrediction(row.result_json), []);
}

const shortOverlap = summarizeOverlapFrames([
  false,
  true,
  true,
  true,
  true,
  true,
  false,
]);
assert.equal(shortOverlap.present, false);

const sustainedOverlap = summarizeOverlapFrames([
  false,
  ...Array.from({ length: 18 }, () => true),
  false,
]);
assert.equal(sustainedOverlap.present, true);
assert.ok(sustainedOverlap.longestSeconds >= 0.4);

function buildTestSignal(seconds, frequency, intervals) {
  const sampleRate = 8000;
  const samples = new Float32Array(sampleRate * seconds);
  for (const [startSeconds, endSeconds] of intervals) {
    for (
      let index = Math.floor(startSeconds * sampleRate);
      index < Math.min(samples.length, Math.floor(endSeconds * sampleRate));
      index += 1
    ) {
      const phase = 2 * Math.PI * frequency * index / sampleRate;
      const envelope = 0.72 + 0.28 * Math.sin(2 * Math.PI * 4.2 * index / sampleRate);
      samples[index] = envelope * (
        0.12 * Math.sin(phase) +
        0.055 * Math.sin(phase * 2 + 0.3) +
        0.025 * Math.sin(phase * 3 + 0.7)
      );
    }
  }
  return samples;
}

const separateLeft = buildTestSignal(3, 130, [[0.2, 1.1]]);
const separateRight = buildTestSignal(3, 220, [[1.5, 2.5]]);
assert.equal(analyzeStereoOverlap(separateLeft, separateRight, 8000).present, false);

const overlappingLeft = buildTestSignal(3, 130, [[0.2, 1.8]]);
const overlappingRight = buildTestSignal(3, 223, [[1.1, 2.5]]);
const stereoOverlap = analyzeStereoOverlap(overlappingLeft, overlappingRight, 8000);
assert.equal(stereoOverlap.method, "independent_stereo_vad");
assert.equal(stereoOverlap.present, true);
assert.ok(stereoOverlap.longestSeconds >= 0.4);

const duplicateStereo = analyzeStereoOverlap(overlappingLeft, overlappingLeft, 8000);
assert.equal(duplicateStereo.available, false);
assert.equal(duplicateStereo.duplicateChannels, true);

assert.equal(analyzeMonoOverlap(overlappingLeft, 8000).present, false);
const mixedMono = new Float32Array(overlappingLeft.length);
for (let index = 0; index < mixedMono.length; index += 1) {
  mixedMono[index] = overlappingLeft[index] + overlappingRight[index];
}
const monoOverlap = analyzeMonoOverlap(mixedMono, 8000);
assert.equal(monoOverlap.method, "mono_stable_dual_periodicity");
assert.equal(monoOverlap.present, true);

const quietFeatures = {
  noisePresent: false,
  segmentDensity: 0.4,
  noiseFloor: 0.0002,
  noiseRatio: 0.04,
  signalToNoise: 25,
  flatness: 0.08,
  transientRate: 0.001,
};

assert.equal(
  detectBackgroundNoise({
    segmentDensity: 3.0507,
    noiseFloor: 0.0006496,
    noiseRatio: 0.0107,
    signalToNoise: 93.416,
    flatness: 0.0998,
    transientRate: 0,
  }),
  false,
);

const cleanSantaMetrics = {
  signalToNoise: 93.416,
  noiseRatio: 0.0107,
  transientRate: 0,
};
const cleanSantaResult = {
  background_noise_present: false,
  background_noise_type: "",
  background_noise_severity: "none",
};
assert.deepEqual(
  fuseAudioEventNoise(cleanSantaResult, cleanSantaMetrics, {
    available: true,
    candidate: {
      type: "music",
      confidence: 0.00057,
      meanConfidence: 0.00034,
      persistence: 0,
      backgroundActivity: 0,
    },
    candidates: [
      { type: "music", confidence: 0.00057 },
      { type: "TV", confidence: 0.00032 },
    ],
  }),
  cleanSantaResult,
);
assert.deepEqual(
  fuseAudioEventNoise(
    cleanSantaResult,
    {
      segmentDensity: 2.5,
      noiseFloor: 0.0004,
      noiseRatio: 0.03,
      signalToNoise: 30,
      flatness: 0.1,
      transientRate: 0.002,
    },
    {
      available: true,
      candidate: {
        type: "TV",
        confidence: 0.023,
        meanConfidence: 0.0086,
        persistence: 0,
        backgroundActivity: 0.15,
      },
      candidates: [
        { type: "TV", confidence: 0.023 },
        { type: "alarm or siren", confidence: 0.0024 },
        { type: "music", confidence: 0.0011 },
      ],
    },
  ),
  {
    background_noise_present: true,
    background_noise_type: "TV",
    background_noise_severity: "medium",
  },
);
assert.deepEqual(
  fuseAudioEventNoise(
    {
      background_noise_present: true,
      background_noise_type: "background noise",
      background_noise_severity: "medium",
    },
    { signalToNoise: 8, noiseRatio: 0.2, transientRate: 0.02 },
    {
      available: true,
      candidate: {
        type: "TV",
        confidence: 0.42,
        meanConfidence: 0.16,
        persistence: 0.3,
        backgroundActivity: 0.5,
      },
      candidates: [
        { type: "TV", confidence: 0.42 },
        { type: "music", confidence: 0.08 },
      ],
    },
  ),
  {
    background_noise_present: true,
    background_noise_type: "TV",
    background_noise_severity: "medium",
  },
);
assert.equal(
  detectBackgroundNoise({
    segmentDensity: 2.83,
    noiseFloor: 0.0009165,
    noiseRatio: 0.0093,
    signalToNoise: 107.65,
    flatness: 0.088,
    transientRate: 0.0003,
  }),
  true,
);

assert.equal(classifyNoiseSeverity(quietFeatures), "none");
assert.equal(classifyNoiseSeverity({ ...quietFeatures, noisePresent: true }), "low");
assert.equal(
  classifyNoiseSeverity({ ...quietFeatures, noisePresent: true, noiseRatio: 0.4, signalToNoise: 2.5 }),
  "medium",
);
assert.equal(
  classifyNoiseSeverity({ ...quietFeatures, noisePresent: true, noiseRatio: 0.82, signalToNoise: 1.2 }),
  "high",
);

assert.deepEqual(
  classifyTranscriptEmotion("What do you mean, how can you help me? Just fucking get back to me!"),
  {
    tone: "upset",
    intensity: "high",
    score: 0.9,
    signalCounts: {
      severeDistress: 0,
      distress: 0,
      profanity: 1,
      confrontation: 2,
      frustration: 0,
      positive: 0,
    },
  },
);
assert.equal(
  classifyTranscriptEmotion("I am frustrated because this was cancelled again.").tone,
  "frustrated",
);
assert.equal(classifyTranscriptEmotion("I am not frustrated, no problem.").tone, "neutral");
assert.equal(classifyTranscriptEmotion("Thank you, I really appreciate your help.").tone, "satisfied");
assert.deepEqual(
  applySemanticTone({
    tone: "satisfied",
    intensity: "medium",
    semanticEvidence: classifyTranscriptEmotion(
      "What do you mean, how can you help me? Just fucking get back to me!",
    ),
    acousticallyDistressed: false,
  }),
  { tone: "upset", intensity: "high" },
);

const neutralStaffScore = scoreCustomerCandidate({
  speechRatio: 0.7,
  baselineTone: "neutral",
  modelEvidence: {
    labels: { neu: 0.84, ang: 0.05, hap: 0.08, sad: 0.03 },
    margin: 0.76,
  },
});
const emotionalCustomerScore = scoreCustomerCandidate({
  speechRatio: 0.45,
  baselineTone: "frustrated",
  modelEvidence: {
    labels: { neu: 0.1, ang: 0.72, hap: 0.05, sad: 0.13 },
    margin: 0.59,
  },
});
assert.ok(emotionalCustomerScore > neutralStaffScore);
assert.equal(
  hasStrongDistressEvidence({
    labels: { neu: 0.0084, ang: 0.006, hap: 0.0015, sad: 0.9841 },
    margin: 0.9757,
  }),
  true,
);
assert.equal(
  hasStrongDistressEvidence({
    labels: { neu: 0.2, ang: 0.08, hap: 0.05, sad: 0.67 },
    margin: 0.47,
  }),
  false,
);

console.log("analysis rule checks passed");
