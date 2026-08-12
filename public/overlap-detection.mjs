const ANALYSIS_SAMPLE_RATE = 8000;
const FRAME_SECONDS = 0.05;
const HOP_SECONDS = 0.025;
const MIN_OVERLAP_SECONDS = 0.3;
const MIN_TOTAL_OVERLAP_SECONDS = 0.4;

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function percentile(values, fraction) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const position = (sorted.length - 1) * fraction;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] * (upper - position) + sorted[upper] * (position - lower);
}

function resample(samples, sourceRate) {
  if (sourceRate === ANALYSIS_SAMPLE_RATE) return samples;
  const outputLength = Math.max(1, Math.round(samples.length * ANALYSIS_SAMPLE_RATE / sourceRate));
  const output = new Float32Array(outputLength);
  const ratio = sourceRate / ANALYSIS_SAMPLE_RATE;
  for (let index = 0; index < outputLength; index += 1) {
    const position = index * ratio;
    const left = Math.floor(position);
    const right = Math.min(samples.length - 1, left + 1);
    const fraction = position - left;
    output[index] = samples[left] * (1 - fraction) + samples[right] * fraction;
  }
  return output;
}

function frameSignal(samples) {
  const frameSize = Math.round(ANALYSIS_SAMPLE_RATE * FRAME_SECONDS);
  const hopSize = Math.round(ANALYSIS_SAMPLE_RATE * HOP_SECONDS);
  const frames = [];
  const rms = [];
  for (let offset = 0; offset + frameSize <= samples.length; offset += hopSize) {
    const frame = samples.subarray(offset, offset + frameSize);
    let energy = 0;
    let crossings = 0;
    for (let index = 0; index < frame.length; index += 1) {
      energy += frame[index] * frame[index];
      if (
        index > 0 &&
        ((frame[index - 1] >= 0 && frame[index] < 0) ||
          (frame[index - 1] < 0 && frame[index] >= 0))
      ) {
        crossings += 1;
      }
    }
    const frameRms = Math.sqrt(energy / Math.max(1, frame.length));
    frames.push({
      frame,
      rms: frameRms,
      zcr: crossings / Math.max(1, frame.length - 1),
    });
    rms.push(frameRms);
  }

  const threshold = Math.max(
    0.0012,
    percentile(rms, 0.2) * 2.2,
    percentile(rms, 0.65) * 0.58,
  );
  return {
    frames,
    speechFlags: frames.map((entry) => entry.rms >= threshold),
    threshold,
  };
}

function normalizedCorrelation(left, right) {
  let leftMean = 0;
  let rightMean = 0;
  for (let index = 0; index < left.length; index += 2) {
    leftMean += left[index];
    rightMean += right[index];
  }
  const points = Math.ceil(left.length / 2);
  leftMean /= Math.max(1, points);
  rightMean /= Math.max(1, points);

  let product = 0;
  let leftEnergy = 0;
  let rightEnergy = 0;
  for (let index = 0; index < left.length; index += 2) {
    const leftValue = left[index] - leftMean;
    const rightValue = right[index] - rightMean;
    product += leftValue * rightValue;
    leftEnergy += leftValue * leftValue;
    rightEnergy += rightValue * rightValue;
  }
  return product / (Math.sqrt(leftEnergy * rightEnergy) + 1e-12);
}

function bridgeShortGaps(flags, maximumGapFrames = 2) {
  const bridged = [...flags];
  let index = 0;
  while (index < bridged.length) {
    if (bridged[index]) {
      index += 1;
      continue;
    }
    const start = index;
    while (index < bridged.length && !bridged[index]) index += 1;
    const gapLength = index - start;
    if (start > 0 && index < bridged.length && gapLength <= maximumGapFrames) {
      for (let gapIndex = start; gapIndex < index; gapIndex += 1) bridged[gapIndex] = true;
    }
  }
  return bridged;
}

export function summarizeOverlapFrames(flags, hopSeconds = HOP_SECONDS) {
  const bridged = bridgeShortGaps(flags);
  let longestFrames = 0;
  let totalFrames = 0;
  let currentFrames = 0;
  for (const flag of bridged) {
    if (flag) {
      currentFrames += 1;
      totalFrames += 1;
      longestFrames = Math.max(longestFrames, currentFrames);
    } else {
      currentFrames = 0;
    }
  }
  const longestSeconds = longestFrames * hopSeconds;
  const totalSeconds = totalFrames * hopSeconds;
  return {
    present:
      longestSeconds >= MIN_OVERLAP_SECONDS &&
      totalSeconds >= MIN_TOTAL_OVERLAP_SECONDS,
    longestSeconds: Number(longestSeconds.toFixed(3)),
    totalSeconds: Number(totalSeconds.toFixed(3)),
    frameRatio: flags.length ? totalFrames / flags.length : 0,
  };
}

function channelSimilarity(left, right) {
  const length = Math.min(left.length, right.length);
  const step = Math.max(1, Math.floor(length / 24000));
  let differenceEnergy = 0;
  let signalEnergy = 0;
  let product = 0;
  let leftEnergy = 0;
  let rightEnergy = 0;
  for (let index = 0; index < length; index += step) {
    const leftValue = left[index];
    const rightValue = right[index];
    const difference = leftValue - rightValue;
    differenceEnergy += difference * difference;
    signalEnergy += leftValue * leftValue + rightValue * rightValue;
    product += leftValue * rightValue;
    leftEnergy += leftValue * leftValue;
    rightEnergy += rightValue * rightValue;
  }
  return {
    differenceRatio: differenceEnergy / Math.max(signalEnergy, 1e-12),
    correlation: product / (Math.sqrt(leftEnergy * rightEnergy) + 1e-12),
  };
}

export function analyzeStereoOverlap(leftSamples, rightSamples, sampleRate) {
  const rawSimilarity = channelSimilarity(leftSamples, rightSamples);
  const duplicate =
    rawSimilarity.differenceRatio < 0.001 || Math.abs(rawSimilarity.correlation) > 0.995;
  if (duplicate) {
    return {
      available: false,
      present: false,
      method: "dual_mono_fallback",
      duplicateChannels: true,
      channelSimilarity: rawSimilarity,
    };
  }

  const left = frameSignal(resample(leftSamples, sampleRate));
  const right = frameSignal(resample(rightSamples, sampleRate));
  const frameCount = Math.min(left.frames.length, right.frames.length);
  const overlapFlags = [];
  let simultaneousFrames = 0;
  let rejectedCrosstalkFrames = 0;

  for (let index = 0; index < frameCount; index += 1) {
    if (!left.speechFlags[index] || !right.speechFlags[index]) {
      overlapFlags.push(false);
      continue;
    }
    simultaneousFrames += 1;
    const leftFrame = left.frames[index];
    const rightFrame = right.frames[index];
    const correlation = Math.abs(normalizedCorrelation(leftFrame.frame, rightFrame.frame));
    const energyBalance =
      Math.min(leftFrame.rms, rightFrame.rms) / Math.max(leftFrame.rms, rightFrame.rms, 1e-12);
    const independentSpeech = correlation < 0.82 && energyBalance >= 0.08;
    if (!independentSpeech) rejectedCrosstalkFrames += 1;
    overlapFlags.push(independentSpeech);
  }

  return {
    available: true,
    method: "independent_stereo_vad",
    duplicateChannels: false,
    channelSimilarity: rawSimilarity,
    simultaneousFrames,
    rejectedCrosstalkFrames,
    ...summarizeOverlapFrames(overlapFlags),
  };
}

function applyHannWindow(frame) {
  const windowed = new Float32Array(frame.length);
  for (let index = 0; index < frame.length; index += 1) {
    const window = 0.5 - 0.5 * Math.cos(2 * Math.PI * index / (frame.length - 1));
    windowed[index] = frame[index] * window;
  }
  return windowed;
}

function goertzelPower(windowedFrame, frequency) {
  const omega = 2 * Math.PI * frequency / ANALYSIS_SAMPLE_RATE;
  const coefficient = 2 * Math.cos(omega);
  let first = 0;
  let second = 0;
  for (let index = 0; index < windowedFrame.length; index += 1) {
    const value = windowedFrame[index] + coefficient * first - second;
    second = first;
    first = value;
  }
  return Math.max(0, first * first + second * second - coefficient * first * second);
}

function spectralPitchCandidates(frame) {
  const windowedFrame = applyHannWindow(frame);
  const scores = [];
  for (let pitch = 75; pitch <= 340; pitch += 5) {
    let score = 0;
    let weight = 1;
    for (let harmonic = 1; harmonic <= 4; harmonic += 1) {
      const frequency = pitch * harmonic;
      if (frequency >= ANALYSIS_SAMPLE_RATE / 2) break;
      score += goertzelPower(windowedFrame, frequency) * weight;
      weight *= 0.55;
    }
    scores.push({ pitch, score });
  }

  const peaks = scores.filter((entry, index) => {
    const previous = scores[index - 1]?.score ?? -Infinity;
    const next = scores[index + 1]?.score ?? -Infinity;
    return entry.score >= previous && entry.score >= next;
  });
  const maximumScore = Math.max(1e-12, ...peaks.map((entry) => entry.score));
  return peaks
    .map((entry) => ({ ...entry, normalizedScore: entry.score / maximumScore }))
    .sort((left, right) => right.score - left.score);
}

function harmonicRelation(firstPitch, secondPitch) {
  const ratio = Math.max(firstPitch, secondPitch) / Math.max(1, Math.min(firstPitch, secondPitch));
  return [1, 1.5, 2, 2.5, 3].some((harmonic) => Math.abs(ratio - harmonic) < 0.1);
}

function detectTwoVoicePeriods(frameEntry) {
  if (frameEntry.zcr < 0.012 || frameEntry.zcr > 0.2) return null;
  const peaks = spectralPitchCandidates(frameEntry.frame);
  const primary = peaks[0];
  if (!primary) return null;
  const secondary = peaks.find(
    (entry) =>
      Math.abs(entry.pitch - primary.pitch) >= 35 &&
      !harmonicRelation(primary.pitch, entry.pitch),
  );
  if (
    !secondary ||
    secondary.normalizedScore < 0.18
  ) {
    return null;
  }

  const ordered = [primary, secondary].sort((left, right) => left.pitch - right.pitch);
  return {
    lowPitch: ordered[0].pitch,
    highPitch: ordered[1].pitch,
    strength: secondary.normalizedScore,
  };
}

function voicePairsAreConsistent(left, right) {
  if (!left || !right) return false;
  const lowTolerance = Math.max(16, Math.min(left.lowPitch, right.lowPitch) * 0.14);
  const highTolerance = Math.max(20, Math.min(left.highPitch, right.highPitch) * 0.14);
  return (
    Math.abs(left.lowPitch - right.lowPitch) <= lowTolerance &&
    Math.abs(left.highPitch - right.highPitch) <= highTolerance
  );
}

function stableVoicePairFlags(candidates) {
  return candidates.map((candidate, index) => {
    if (!candidate) return false;
    let supportingNeighbors = 0;
    for (
      let neighborIndex = Math.max(0, index - 2);
      neighborIndex <= Math.min(candidates.length - 1, index + 2);
      neighborIndex += 1
    ) {
      if (
        neighborIndex !== index &&
        voicePairsAreConsistent(candidate, candidates[neighborIndex])
      ) {
        supportingNeighbors += 1;
      }
    }
    return supportingNeighbors >= 2;
  });
}

export function analyzeMonoOverlap(samples, sampleRate) {
  const signal = frameSignal(resample(samples, sampleRate));
  const voicePairs = signal.frames.map((entry, index) =>
    signal.speechFlags[index] ? detectTwoVoicePeriods(entry) : null,
  );
  const overlapFlags = stableVoicePairFlags(voicePairs);
  return {
    available: true,
    method: "mono_stable_dual_periodicity",
    duplicateChannels: false,
    speechFrames: signal.speechFlags.filter(Boolean).length,
    candidateFrames: voicePairs.filter(Boolean).length,
    evidenceFrames: overlapFlags.filter(Boolean).length,
    ...summarizeOverlapFrames(overlapFlags),
  };
}
