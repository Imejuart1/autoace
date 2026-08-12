# AutoAce Trial Dashboard

This repository contains a hosted dashboard for the AutoAce voice-tone and background-noise technical trial. It uses browser-side acoustic checks plus Vercel-hosted emotion and speech-to-text models for acoustic and semantic tone evidence.

## What is included

- Folder upload support through `webkitdirectory`
- ZIP upload support for standard stored or deflate-compressed archives
- Manifest validation against `labels.csv`
- Browser-side audio decoding, acoustic feature extraction, and YAMNet AudioSet event detection
- Vercel-hosted emotion-model evidence blended with the acoustic baseline
- Local Whisper transcription and conservative transcript-emotion classification
- Predictions download as CSV and JSON
- Validation summary and confusion matrix when ground truth is present
- Runtime and cost summary for each processed batch

## How to run locally

1. Start the Node server:

```powershell
npm start
```

2. Visit `http://localhost:3000/login`.

### Hosted inference on Vercel

The hosted deployment keeps everything inside one Vercel project:

- the dashboard UI
- login/session handling
- the tone inference endpoint at `/api/tone`

The model runs in Vercel's Node runtime using `@huggingface/transformers`, so no separate Python service is required for the hosted submission.

## Routes

- `http://localhost:3000/login` for the standalone sign-in page
- `http://localhost:3000/home` for the authenticated dashboard
- Visiting `/` will send you to the right route automatically

If you prefer, you can also run `node server.js` directly.

## Current status

- The dashboard is runnable locally in this workspace through the bundled Node server.
- The login flow is session-backed with an HttpOnly cookie instead of a client-only gate.
- The current inference path uses no paid model API. Vercel compute is infrastructure cost and must be measured separately under the deployment plan.
- The dashboard includes a credentialed sign-in screen. A separate register flow is not necessary for this trial unless AutoAce asks for self-service account creation.

## Login

- Username: `autoace`
- Password: `AutoAce2026!`
- To change the shared credentials for the hosted version, set `AUTOACE_USERNAME` and `AUTOACE_PASSWORD` before starting the server.

## Notes on the current model

- The acoustic baseline estimates tone, noise, overlap, silence, and quality from decoded waveform features.
- Background-noise detection fuses YAMNet's 521-class learned event scores with the acoustic baseline. Quiet events are accepted only when they persist across analysis frames and clearly dominate competing event classes; this avoids treating every compression artifact as meaningful noise.
- Noise type comes from the learned event family rather than a filename or manifest label. The manifest is used only after inference to compute validation metrics.
- The hosted tone model runs `onnx-community/Speech-Emotion-Classification-ONNX` on selected 16 kHz speech segments and blends high-confidence `neutral`, `angry`, `happy`, and `sad` evidence with the baseline.
- Multilingual Whisper first identifies the spoken language. English segments are transcribed by `onnx-community/whisper-tiny.en`; other supported languages use `onnx-community/whisper-tiny` with English translation so the same conservative semantic rules can evaluate the wording.
- The detected language is reused across the remaining selected segments of a clip, avoiding repeated language-identification work.
- Split-channel candidates also share the call-level language hint. For English, the multilingual detection session is released before the English-only model is loaded to keep serverless memory bounded.
- Tone endpoint inference is serialized within each serverless instance so one request cannot release a model session while another request is using it.
- The models are downloaded on first use and cached by the Vercel runtime; production-call audio is sent only to the authenticated application endpoint, not to an LLM or paid inference API.
- The emotion model is evidence, not ground truth: it was trained on four broad IEMOCAP classes, so the app retains rule-based safeguards for the five AutoAce labels.

## Measured performance

- An earlier three-call run produced tone accuracy `0.667`, observed-class tone macro F1 `0.667`, noise accuracy `1.000`, and quality accuracy `1.000`; these historical numbers are not claimed for the current model until the complete batch is rerun.
- The semantic regression for an acoustically positive but verbally aggressive clip now resolves to `upset` / `high`.
- Cached emotion plus Whisper inference measured about `5.31 s` for one 18-second segment on this machine. The first uncached model download and initialization measured about `69.8 s`.
- The complete three-call batch must be rerun after the semantic and overlap changes before publishing final validation metrics.

## Next improvements

- Calibrate the model-label mapping on a larger dealership-call set.
- Add true diarization and speaker-role detection for mixed mono calls after collecting more overlap examples.
