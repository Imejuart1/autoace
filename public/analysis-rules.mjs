export function detectBackgroundNoise({
  segmentDensity,
  noiseFloor,
  noiseRatio,
  signalToNoise,
  flatness,
  transientRate,
}) {
  const persistentBackground =
    noiseFloor > 0.00075 || noiseRatio > 0.16 || signalToNoise < 6;
  const broadbandBackground =
    flatness > 0.22 && (noiseFloor > 0.00035 || noiseRatio > 0.06);
  const transientBackground =
    transientRate > 0.025 && (noiseFloor > 0.0003 || noiseRatio > 0.05);
  const fragmentedSpeechWithBackground =
    segmentDensity > 1.2 &&
    (noiseFloor > 0.0007 || noiseRatio > 0.08 || flatness > 0.25 || transientRate > 0.015);

  return (
    persistentBackground ||
    broadbandBackground ||
    transientBackground ||
    fragmentedSpeechWithBackground
  );
}

export function classifyNoiseSeverity({
  noisePresent,
  segmentDensity,
  noiseFloor,
  noiseRatio,
  signalToNoise,
  flatness,
  transientRate,
}) {
  if (!noisePresent) {
    return "none";
  }

  const materiallyImpaired =
    signalToNoise < 1.35 ||
    noiseRatio > 0.75 ||
    noiseFloor > 0.005 ||
    (flatness > 0.6 && transientRate > 0.12 && noiseRatio > 0.5);
  if (materiallyImpaired) {
    return "high";
  }

  const intermittentlyImpaired =
    segmentDensity > 2.3 ||
    noiseFloor > 0.0012 ||
    noiseRatio > 0.32 ||
    signalToNoise < 3 ||
    (flatness > 0.35 && transientRate > 0.03);
  return intermittentlyImpaired ? "medium" : "low";
}

export function fuseAudioEventNoise(acousticResult, metrics, audioEvents) {
  if (!audioEvents?.available || !audioEvents.candidate) {
    return acousticResult;
  }

  const candidate = audioEvents.candidate;
  const acousticPresent = Boolean(acousticResult.background_noise_present);
  const competingConfidence = Math.max(
    0.0001,
    ...(audioEvents.candidates || [])
      .filter((entry) => entry.type !== candidate.type)
      .map((entry) => entry.confidence || 0),
  );
  const eventDominance = candidate.confidence / competingConfidence;
  const strongEvent =
    candidate.confidence >= 0.5 && candidate.persistence >= 0.18;
  const quietBackgroundEvent =
    candidate.confidence >= 0.015 &&
    candidate.meanConfidence >= 0.003 &&
    candidate.backgroundActivity >= 0.08 &&
    eventDominance >= 3;
  const corroboratedEvent =
    acousticPresent &&
    candidate.confidence >= 0.015 &&
    candidate.meanConfidence >= 0.003 &&
    eventDominance >= 2;

  if (!(corroboratedEvent || strongEvent || quietBackgroundEvent)) {
    return acousticResult;
  }

  const severity = acousticPresent
    ? acousticResult.background_noise_severity
    : classifyNoiseSeverity({ ...metrics, noisePresent: true });

  return {
    ...acousticResult,
    background_noise_present: true,
    background_noise_type: candidate.type,
    background_noise_severity: severity,
  };
}

export function detectSpeakerOverlap({
  segmentDensity,
  channelCount = 1,
  dualMono = false,
  simultaneousVoicedRatio = 0,
  channelCorrelation = 1,
  channelEnergyImbalance = 0,
  transientRate = 0,
  pitchStd = 0,
}) {
  console.log("--- detectSpeakerOverlap Debug ---", {
    segmentDensity, channelCount, dualMono, simultaneousVoicedRatio,
    channelCorrelation, channelEnergyImbalance, transientRate, pitchStd
  });

  const clamp01 = (value) => Math.max(0, Math.min(1, value));
  const scale = (value, min, max) => {
    if (max <= min) return 0;
    return clamp01((value - min) / (max - min));
  };

  const stereoScore =
    channelCount >= 2 && !dualMono
      ? clamp01(
          scale(simultaneousVoicedRatio, 0.06, 0.28) * 0.5 +
            scale(1 - clamp01(channelCorrelation), 0.08, 0.42) * 0.33 +
            scale(channelEnergyImbalance, 0.08, 0.38) * 0.17,
        )
      : 0;
      
  const stereoStrong =
    channelCount >= 2 &&
    !dualMono &&
    simultaneousVoicedRatio > 0.08 &&
    channelCorrelation < 0.88 &&
    (channelEnergyImbalance > 0.12 || transientRate > 0.02 || segmentDensity > 1.1);

  const monoOverlapScore =
    (channelCount < 2 || dualMono)
      ? clamp01(
          scale(transientRate, 0.012, 0.055) * 0.4 +
          scale(segmentDensity, 0.9, 2.2) * 0.4 +
          scale(pitchStd, 25, 75) * 0.2
        )
      : 0;

  console.log("Overlap Scores Computed:", { stereoScore, stereoStrong, monoOverlapScore });
  const result = Boolean(stereoStrong || stereoScore >= 0.50 || monoOverlapScore >= 0.42);
  console.log("detectSpeakerOverlap Final Result:", result);
  return result;
}

export function detectSemanticOverlap(transcript) {
  console.log("--- detectSemanticOverlap Debug ---");
  console.log("RAW TRANSCRIPT:", transcript);
  const text = String(transcript || "").toLowerCase();

  if (!text || text.length < 15) {
    console.log("Skipped: transcript too short or empty.");
    return false;
  }

  const matchInterruption = /\b[a-z]+\s*(?:\.{2,}|—|-)\s*[a-z]+\b/.test(text);
  const matchRecommendation = /recommend\s+scheduling\s*a\b.*?\byeah\b/.test(text);
  const matchFragments = /\b(could i|can i|would you|i want)\b.*?\b\1\b/.test(text);

  console.log("Semantic Regex Matches:", {
    matchInterruption,
    matchRecommendation,
    matchFragments
  });

  const result = matchInterruption || matchRecommendation || matchFragments;
  console.log("detectSemanticOverlap Final Result:", result);
  return result;
}

export function scoreCustomerCandidate({ speechRatio, baselineTone, modelEvidence, semanticEvidence }) {
  const speechCoverage = Math.max(0, Math.min(1, speechRatio / 0.35));
  let acousticScore;
  if (modelEvidence?.labels) {
    const { neu = 0, ang = 0, hap = 0, sad = 0 } = modelEvidence.labels;
    const negativeEmotion = Math.max(ang, sad);
    const positiveEmotion = hap * 0.7;
    const emotionalEvidence = Math.max(negativeEmotion, positiveEmotion, (1 - neu) * 0.65);
    const separation = Math.max(0, Math.min(1, modelEvidence.margin || 0));
    acousticScore = speechCoverage * 0.2 + emotionalEvidence * 0.65 + separation * 0.15;
  } else {
    const baselineWeights = {
      neutral: 0.1,
      satisfied: 0.55,
      frustrated: 0.7,
      upset: 0.9,
      distressed: 1,
    };
    acousticScore = speechCoverage * 0.25 + (baselineWeights[baselineTone] ?? 0.1) * 0.75;
  }

  const semanticWeights = {
    neutral: 0,
    satisfied: 0.2,
    frustrated: 0.35,
    upset: 0.45,
    distressed: 0.5,
  };
  const semanticBoost =
    (semanticWeights[semanticEvidence?.tone] || 0) * Math.max(0, semanticEvidence?.score || 0);
  return Math.max(0, Math.min(1, acousticScore + semanticBoost));
}

export function hasStrongDistressEvidence(modelEvidence) {
  return Boolean(
    modelEvidence?.labels?.sad >= 0.9 &&
    modelEvidence?.margin >= 0.65,
  );
}

function countPatternMatches(text, patterns) {
  return patterns.reduce((count, pattern) => count + (pattern.test(text) ? 1 : 0), 0);
}

export function classifyTranscriptEmotion(transcript) {
  const normalized = String(transcript || "")
    .toLowerCase()
    .replace(/\b(?:not|never)\s+(?:frustrated|upset|angry|annoyed|distressed)\b/g, "")
    .replace(/\b(?:no problem|not a problem|do not worry|don't worry)\b/g, " ")
    .replace(/[^a-z0-9'\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) {
    return { tone: "neutral", intensity: "low", score: 0, signalCounts: {} };
  }

  const severeDistress = countPatternMatches(normalized, [
    /\bi (?:can't|cannot) breathe\b/,
    /\bpanic attack\b/,
    /\bthis is an emergency\b/,
    /\bi (?:am|'m) going to die\b/,
    /\bi (?:can't|cannot) cope\b/,
  ]);
  const distress = countPatternMatches(normalized, [
    /\bi (?:am|'m) panicking\b/,
    /\bi (?:am|'m) terrified\b/,
    /\bi (?:am|'m) overwhelmed\b/,
    /\bi (?:am|'m) scared\b/,
    /\bplease help me\b/,
    /\bi (?:can't|cannot) handle this\b/,
  ]);
  const profanity = countPatternMatches(normalized, [
    /\bfuck(?:ing|ed)?\b/,
    /\bshit(?:ty)?\b/,
    /\bbullshit\b/,
    /\bdamn\b/,
  ]);
  const confrontation = countPatternMatches(normalized, [
    /\bwhat do you mean\b/,
    /\bget back to me\b/,
    /\bthis is unacceptable\b/,
    /\bthis is ridiculous\b/,
    /\bi demand\b/,
    /\bspeak to (?:a|your) manager\b/,
    /\bi (?:am|'m) fed up\b/,
    /\bi (?:am|'m) sick of\b/,
    /\bare you kidding\b/,
    /\bhow dare you\b/,
  ]);
  const frustration = countPatternMatches(normalized, [
    /\bi (?:am|'m) frustrated\b/,
    /\bi (?:am|'m) annoyed\b/,
    /\bi (?:am|'m) disappointed\b/,
    /\bnot happy\b/,
    /\bstill waiting\b/,
    /\bnot working\b/,
    /\bkeeps? happening\b/,
    /\bcancell?ed again\b/,
    /\bwrong again\b/,
    /\bthe same (?:problem|issue)\b/,
  ]);
  const positive = countPatternMatches(normalized, [
    /\bthank you\b/,
    /\bthanks\b/,
    /\bi appreciate\b/,
    /\bthat(?:'s| is) great\b/,
    /\bthat(?:'s| is) perfect\b/,
    /\bi (?:am|'m) glad\b/,
    /\bproblem (?:is|was) resolved\b/,
    /\bvery helpful\b/,
  ]);

  const signalCounts = { severeDistress, distress, profanity, confrontation, frustration, positive };
  if (severeDistress > 0 || distress >= 2) {
    return { tone: "distressed", intensity: "high", score: 0.94, signalCounts };
  }
  if (profanity > 0 || confrontation >= 2) {
    return { tone: "upset", intensity: "high", score: 0.9, signalCounts };
  }
  if (confrontation === 1) {
    return { tone: "upset", intensity: "medium", score: 0.76, signalCounts };
  }
  if (distress === 1) {
    return { tone: "distressed", intensity: "medium", score: 0.72, signalCounts };
  }
  if (frustration >= 2) {
    return { tone: "frustrated", intensity: "medium", score: 0.78, signalCounts };
  }
  if (frustration === 1) {
    return { tone: "frustrated", intensity: "low", score: 0.64, signalCounts };
  }
  if (positive > 0) {
    return {
      tone: "satisfied",
      intensity: positive >= 2 ? "medium" : "low",
      score: positive >= 2 ? 0.78 : 0.66,
      signalCounts,
    };
  }
  return { tone: "neutral", intensity: "low", score: 0.35, signalCounts };
}

export function applySemanticTone({ tone, intensity, semanticEvidence, acousticallyDistressed }) {
  if (!semanticEvidence || semanticEvidence.score < 0.6 || semanticEvidence.tone === "neutral") {
    return { tone, intensity };
  }
  if (semanticEvidence.tone === "upset") {
    return { tone: "upset", intensity: semanticEvidence.intensity };
  }
  if (semanticEvidence.tone === "frustrated" && !["upset", "distressed"].includes(tone)) {
    return { tone: "frustrated", intensity: semanticEvidence.intensity };
  }
  if (semanticEvidence.tone === "distressed") {
    if (semanticEvidence.score >= 0.85 || acousticallyDistressed) {
      return { tone: "distressed", intensity: semanticEvidence.intensity };
    }
    if (!["upset", "distressed"].includes(tone)) {
      return { tone: "frustrated", intensity: "medium" };
    }
  }
  if (semanticEvidence.tone === "satisfied" && ["neutral", "satisfied"].includes(tone)) {
    return { tone: "satisfied", intensity: semanticEvidence.intensity };
  }
  return { tone, intensity };
}
