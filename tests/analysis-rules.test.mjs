import assert from "node:assert/strict";

import { Tensor } from "@huggingface/transformers";

import {
  applySemanticTone,
  classifyNoiseSeverity,
  classifyTranscriptEmotion,
  detectBackgroundNoise,
  detectSpeakerOverlap,
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

assert.equal(
  detectSpeakerOverlap({
    segmentDensity: 2.1,
    harmonicity: 0.02,
    pitchStd: 12,
    meanSpeechZcr: 0.018,
    speechRatio: 0.7,
    voicedPitchRatio: 0.6,
    transientRate: 0.01,
  }),
  false,
);

assert.equal(
  detectSpeakerOverlap({
    segmentDensity: 1.15,
    harmonicity: 0.05,
    pitchStd: 17,
    meanSpeechZcr: 0.023,
    speechRatio: 0.44,
    voicedPitchRatio: 0.29,
    transientRate: 0.014,
    pitchConfidenceMean: 0.48,
    channelCount: 1,
  }),
  true,
);

assert.equal(
  detectSpeakerOverlap({
    segmentDensity: 1.08,
    harmonicity: 0.03,
    pitchStd: 11,
    meanSpeechZcr: 0.019,
    speechRatio: 0.41,
    voicedPitchRatio: 0.18,
    transientRate: 0.008,
    pitchConfidenceMean: 0.29,
    channelCount: 2,
    dualMono: false,
    simultaneousVoicedRatio: 0.19,
    channelCorrelation: 0.58,
    channelEnergyImbalance: 0.27,
  }),
  true,
);

assert.equal(
  detectSpeakerOverlap({
    segmentDensity: 1.08,
    harmonicity: 0.03,
    pitchStd: 11,
    meanSpeechZcr: 0.019,
    speechRatio: 0.41,
    voicedPitchRatio: 0.18,
    transientRate: 0.008,
    pitchConfidenceMean: 0.29,
    channelCount: 2,
    dualMono: true,
    simultaneousVoicedRatio: 0.19,
    channelCorrelation: 0.58,
    channelEnergyImbalance: 0.27,
  }),
  false,
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

assert.equal(
  detectSpeakerOverlap({
    segmentDensity: 2,
    harmonicity: 0.1,
    pitchStd: 40,
    meanSpeechZcr: 0.04,
    speechRatio: 0.75,
    voicedPitchRatio: 0.65,
    transientRate: 0.04,
  }),
  true,
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
