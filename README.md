# AutoAce Trial Dashboard

This repository contains a hosted dashboard for the AutoAce voice-tone and background-noise technical trial. It uses browser-side acoustic checks plus a Vercel-hosted pretrained emotion model for tone evidence.

## What is included

- Folder upload support through `webkitdirectory`
- ZIP upload support for standard stored or deflate-compressed archives
- Manifest validation against `labels.csv`
- Browser-side audio decoding and acoustic feature extraction
- Vercel-hosted Wav2Vec2 emotion-model evidence blended with the acoustic baseline
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
- The current inference path uses no paid API, so estimated model-inference cost is effectively `$0.0000` per audio minute under the current architecture.
- The dashboard includes a credentialed sign-in screen. A separate register flow is not necessary for this trial unless AutoAce asks for self-service account creation.

## Login

- Username: `autoace`
- Password: `AutoAce2026!`
- To change the shared credentials for the hosted version, set `AUTOACE_USERNAME` and `AUTOACE_PASSWORD` before starting the server.

## Notes on the current model

- The acoustic baseline estimates tone, noise, overlap, silence, and quality from decoded waveform features.
- The hosted tone model runs `onnx-community/wav2vec2-emotion-recognition-ONNX` on selected 16 kHz speech segments and blends high-confidence `neutral`, `angry`, `happy`, and `sad` evidence with the baseline.
- The model is downloaded on first use and cached by the Vercel runtime; production-call audio is sent only to the model endpoint, not to an LLM or paid API.
- The emotion model is evidence, not ground truth: it was trained on four broad IEMOCAP classes, so the app retains rule-based safeguards for the five AutoAce labels.

## Measured batch performance

- Three-call sample batch runtime: about `13.27 s` total for `3.96` audio minutes.
- That works out to about `3.35 s` of wall time per audio minute, or roughly `17.9x` real-time throughput on this machine.
- Validation on the provided labeled sample batch matches all three labels after calibration.
- The dashboard reports both tone macro F1 over the observed classes and tone macro F1 across all five allowed classes, which is useful because the tiny calibration set only covers three tone classes.

## Next improvements

- Calibrate the model-label mapping on a larger dealership-call set.
- Add diarization or speaker-role detection after collecting more overlap examples.
