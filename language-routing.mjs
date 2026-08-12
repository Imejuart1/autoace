import { LogitsProcessor } from "@huggingface/transformers";

export function languageCodeFromToken(token) {
  const match = String(token || "").match(/^<\|([a-z]{2,3})\|>$/i);
  return match ? match[1].toLowerCase() : "";
}

export function languageNameFromCode(code) {
  const normalized = String(code || "").trim().toLowerCase();
  if (!normalized) {
    return "Unknown";
  }
  try {
    return new Intl.DisplayNames(["en"], { type: "language" }).of(normalized) || normalized;
  } catch {
    return normalized;
  }
}

export function transcriptionRouteForLanguage(code) {
  return String(code || "").trim().toLowerCase() === "en" ? "english" : "multilingual";
}

export class WhisperLanguageLogitsProcessor extends LogitsProcessor {
  constructor(langToId = {}) {
    super();
    this.languages = Object.entries(langToId)
      .map(([token, id]) => ({
        code: languageCodeFromToken(token),
        id: Number(id),
      }))
      .filter((item) => item.code && Number.isInteger(item.id));
    this.prediction = null;
  }

  _call(inputIds, logits) {
    const vocabSize = logits.dims.at(-1);
    const batchSize = logits.dims[0] || 1;
    const allowedByBatch = [];

    for (let batchIndex = 0; batchIndex < batchSize; batchIndex += 1) {
      const offset = batchIndex * vocabSize;
      const candidates = this.languages
        .filter((item) => item.id >= 0 && item.id < vocabSize)
        .map((item) => ({ ...item, logit: Number(logits.data[offset + item.id]) }));
      if (!candidates.length) {
        throw new Error("Whisper did not expose any language tokens.");
      }

      const maxLogit = Math.max(...candidates.map((item) => item.logit));
      const denominator = candidates.reduce(
        (sum, item) => sum + Math.exp(item.logit - maxLogit),
        0,
      );
      const ordered = candidates
        .map((item) => ({
          ...item,
          confidence: Math.exp(item.logit - maxLogit) / Math.max(denominator, Number.EPSILON),
        }))
        .sort((left, right) => right.logit - left.logit);

      allowedByBatch.push(candidates);
      if (batchIndex === 0) {
        this.prediction = {
          code: ordered[0].code,
          confidence: ordered[0].confidence,
          alternatives: ordered.slice(0, 3).map((item) => ({
            code: item.code,
            confidence: item.confidence,
          })),
        };
      }
    }

    logits.data.fill(-Infinity);
    for (let batchIndex = 0; batchIndex < batchSize; batchIndex += 1) {
      const offset = batchIndex * vocabSize;
      for (const item of allowedByBatch[batchIndex]) {
        logits.data[offset + item.id] = item.logit;
      }
    }
    return logits;
  }
}
