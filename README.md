# AutoAce Voice Intelligence Trial

Hosted dashboard and reproducible hybrid inference pipeline for emotional tone, background noise, audio quality, speaker overlap, long silence, and confidence scoring in production-call audio.

## Hosted Evaluation

- URL: https://autoace-trial-dashboard.vercel.app
- Username: `autoace`
- Password: `AutoAce2026!`

The evaluator can sign in, upload a single clip, folder, or ZIP batch, review progress and per-file failures, inspect predictions, and download CSV or JSON results without using a command line.

## Supported Workflow

- Audio formats: WAV, OGG, MP3, M4A, AAC, FLAC, WebM, and Opus, subject to browser codec support.
- Batch inputs: folder contents or a ZIP archive with audio files at the root.
- Manifest: a CSV with `name` and optional `result_json` columns.
- `name`: exact audio filename including extension.
- `result_json`: optional ground-truth JSON used only for post-inference dashboard metrics.
- Output: downloadable CSV and JSON preserving the original filename.
- Failure isolation: an unsupported or malformed clip is reported without stopping valid files.

Example:

```text
evaluation_batch/
  call_001.wav
  call_002.ogg
  labels.csv
```

```csv
name,result_json
call_001.wav,
call_002.ogg,
```

The manifest may have any filename when uploaded through the dedicated manifest input. A folder or ZIP auto-detects `labels.csv` when present.

## Output Schema

Every successful result contains exactly these prediction fields:

```json
{
  "emotional_tone": "neutral",
  "emotional_intensity": "low",
  "background_noise_present": false,
  "background_noise_type": "",
  "background_noise_severity": "none",
  "audio_quality": "clear",
  "speaker_overlap_present": false,
  "long_silence_present": false,
  "confidence": 0.81
}
```

Allowed enums match the trial specification:

- `emotional_tone`: `neutral`, `satisfied`, `frustrated`, `upset`, `distressed`
- `emotional_intensity`: `low`, `medium`, `high`
- `background_noise_severity`: `none`, `low`, `medium`, `high`
- `audio_quality`: `clear`, `slightly_impaired`, `severely_impaired`
- `confidence`: number from `0.0` through `1.0`

`background_noise_type` is concise open text and is empty when noise is absent.

## Architecture

### Browser-side technical analysis

- Audio decoding and mono/stereo inspection
- Frame-level energy, pitch, spectral, clipping, pause, and silence features
- YAMNet AudioSet environmental-event classification through ONNX Runtime Web
- Acoustic/event fusion for noise presence, type, and severity
- Frame-level speaker overlap detection
- Audio-quality and long-silence checks

### Authenticated Vercel inference

- `onnx-community/Speech-Emotion-Classification-ONNX` supplies broad acoustic emotion evidence.
- Whisper Tiny identifies language and transcribes selected speech segments.
- English uses `onnx-community/whisper-tiny.en`.
- Other detected languages use multilingual `onnx-community/whisper-tiny` with English translation for a shared semantic classifier.
- Acoustic, pretrained, and transcript evidence are fused conservatively into the five AutoAce tone labels.

Only selected speech segments are sent to the authenticated application endpoint. No production audio is sent to an LLM, paid inference API, or public upload service.

## Leakage Prevention

- Filenames do not affect prediction.
- Manifest labels do not affect prediction.
- `result_json` is parsed only after inference for optional validation display.
- Noise, quality, overlap, and silence do not use transcript sentiment.
- Loudness alone does not determine frustration, upset, or distress.
- Poor technical quality alone does not imply background noise.

## Local Setup

Requirements:

- Node.js 18 or newer
- A modern browser with Web Audio and WebAssembly support

Install and run:

```powershell
npm ci
npm start
```

Open `http://localhost:3000/login`.

Run regression checks:

```powershell
npm test
```

The first tone request may download model files from Hugging Face. Later requests reuse the runtime cache when the hosting environment retains it.

## Configuration

The local defaults are the evaluator credentials shown above. Production deployments should set:

```text
AUTOACE_USERNAME
AUTOACE_PASSWORD
AUTOACE_AUTH_SECRET
AUTOACE_COOKIE_SECURE=1
```

Optional model controls:

```text
AUTOACE_TONE_MODEL
AUTOACE_TONE_MODEL_DTYPE
AUTOACE_ENGLISH_ASR_MODEL
AUTOACE_MULTILINGUAL_ASR_MODEL
AUTOACE_ASR_MODEL_DTYPE
AUTOACE_ASR_ENABLED
```

## Deployment

The repository is linked to one Vercel project. Manual production deployment:

```powershell
npx vercel --prod
```

The project contains no required Python service and no paid API key.

## Validation Position

The dashboard computes field accuracy, tone accuracy, macro F1, and a confusion matrix when a labeled manifest is supplied. Those labels are evaluation inputs only. This repository does not claim hidden-set accuracy from three examples, training-set agreement, or statistically calibrated per-class performance.

Automated tests cover schema-related rules, semantic regressions, language routing, clean/noisy fusion behavior, duplicate-channel rejection, separate stereo turns, sustained stereo overlap, and mono dual-voice evidence.

## Known Limitations

- The emotion model uses broad general-purpose emotion classes rather than dealership-specific labels.
- Sarcasm, indirect dissatisfaction, transcription errors, and code-switching can affect tone.
- Mono overlap is harder than independently recorded stereo overlap.
- Foreground speech can mask quiet noise; TV, radio, and nearby chatter can be confused.
- Echo, packet loss, and robotic audio are estimated through signal proxies rather than a dedicated telecom-quality model.
- Confidence is an internal evidence score, not a probability calibrated on a large dealership-call corpus.

See [TECHNICAL_MEMO.md](TECHNICAL_MEMO.md) for design tradeoffs, cost assumptions, latency measurements, and next steps.

## Repository Map

- `public/app.mjs`: batch workflow, feature extraction, fusion, display, and downloads
- `public/analysis-rules.mjs`: deterministic decision and semantic rules
- `public/yamnet-noise.mjs`: learned environmental-event inference
- `public/overlap-detection.mjs`: frame-level stereo and mono overlap analysis
- `public/prediction-schema.mjs`: exact output contract validation
- `tone_model.mjs`: hosted emotion and Whisper inference
- `api/`: Vercel authentication, page, and inference handlers
- `tests/analysis-rules.test.mjs`: deterministic regression checks
- `TECHNICAL_MEMO.md`: experimental and production analysis
- `THIRD_PARTY_NOTICES.md`: model and runtime attribution
- `SECURITY.md`: data-flow, authentication, and dependency-risk notes
- `PROVIDED_CALL_PREDICTIONS.json`: versioned predictions for the three provided calls
