import assert from "node:assert/strict";

import {
  applySemanticTone,
  classifyNoiseSeverity,
  classifyTranscriptEmotion,
  detectSpeakerOverlap,
  hasStrongDistressEvidence,
  scoreCustomerCandidate,
} from "../public/analysis-rules.mjs";

const quietFeatures = {
  noisePresent: false,
  segmentDensity: 0.4,
  noiseFloor: 0.0002,
  noiseRatio: 0.04,
  signalToNoise: 25,
  flatness: 0.08,
  transientRate: 0.001,
};

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
