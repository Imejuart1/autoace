export const REQUIRED_PREDICTION_KEYS = [
  "emotional_tone",
  "emotional_intensity",
  "background_noise_present",
  "background_noise_type",
  "background_noise_severity",
  "audio_quality",
  "speaker_overlap_present",
  "long_silence_present",
  "confidence",
];

const TONES = new Set(["neutral", "satisfied", "frustrated", "upset", "distressed"]);
const INTENSITIES = new Set(["low", "medium", "high"]);
const NOISE_SEVERITIES = new Set(["none", "low", "medium", "high"]);
const AUDIO_QUALITIES = new Set(["clear", "slightly_impaired", "severely_impaired"]);

export function validatePrediction(prediction) {
  const errors = [];
  if (!prediction || typeof prediction !== "object" || Array.isArray(prediction)) {
    return ["Prediction must be a JSON object."];
  }

  const keys = Object.keys(prediction);
  const missing = REQUIRED_PREDICTION_KEYS.filter((key) => !keys.includes(key));
  const unexpected = keys.filter((key) => !REQUIRED_PREDICTION_KEYS.includes(key));
  if (missing.length) errors.push(`Missing fields: ${missing.join(", ")}.`);
  if (unexpected.length) errors.push(`Unexpected fields: ${unexpected.join(", ")}.`);

  if (!TONES.has(prediction.emotional_tone)) {
    errors.push("emotional_tone is not an allowed value.");
  }
  if (!INTENSITIES.has(prediction.emotional_intensity)) {
    errors.push("emotional_intensity is not an allowed value.");
  }
  if (typeof prediction.background_noise_present !== "boolean") {
    errors.push("background_noise_present must be a boolean.");
  }
  if (typeof prediction.background_noise_type !== "string") {
    errors.push("background_noise_type must be a string.");
  }
  if (!NOISE_SEVERITIES.has(prediction.background_noise_severity)) {
    errors.push("background_noise_severity is not an allowed value.");
  }
  if (!AUDIO_QUALITIES.has(prediction.audio_quality)) {
    errors.push("audio_quality is not an allowed value.");
  }
  if (typeof prediction.speaker_overlap_present !== "boolean") {
    errors.push("speaker_overlap_present must be a boolean.");
  }
  if (typeof prediction.long_silence_present !== "boolean") {
    errors.push("long_silence_present must be a boolean.");
  }
  if (
    typeof prediction.confidence !== "number" ||
    !Number.isFinite(prediction.confidence) ||
    prediction.confidence < 0 ||
    prediction.confidence > 1
  ) {
    errors.push("confidence must be a finite number from 0.0 through 1.0.");
  }

  if (prediction.background_noise_present === false) {
    if (prediction.background_noise_type !== "") {
      errors.push("background_noise_type must be empty when noise is absent.");
    }
    if (prediction.background_noise_severity !== "none") {
      errors.push("background_noise_severity must be none when noise is absent.");
    }
  } else if (prediction.background_noise_present === true) {
    if (!prediction.background_noise_type.trim()) {
      errors.push("background_noise_type must describe detected noise.");
    }
    if (prediction.background_noise_severity === "none") {
      errors.push("background_noise_severity cannot be none when noise is present.");
    }
  }

  return errors;
}
