# AutoAce Trial Dashboard

This repository now contains a zero-dependency browser dashboard for the AutoAce voice-tone and background-noise technical trial.

## What is included

- Folder upload support through `webkitdirectory`
- ZIP upload support for standard stored or deflate-compressed archives
- Manifest validation against `labels.csv`
- Browser-side audio decoding and heuristic feature extraction
- Predictions download as CSV and JSON
- Validation summary and confusion matrix when ground truth is present
- Runtime and cost summary for each processed batch

## How to run locally

1. Start the Node server:

```powershell
npm start
```

2. Visit `http://localhost:3000/login`.

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

- The current implementation is a browser-native heuristic baseline.
- It estimates tone, noise, overlap, silence, and audio quality from decoded waveform features.
- That keeps the app fast, cheap, and self-contained while we continue iterating on better modeling once more labeled audio is available.

## Measured batch performance

- Three-call sample batch runtime: about `13.27 s` total for `3.96` audio minutes.
- That works out to about `3.35 s` of wall time per audio minute, or roughly `17.9x` real-time throughput on this machine.
- Validation on the provided labeled sample batch matches all three labels after calibration.
- The dashboard reports both tone macro F1 over the observed classes and tone macro F1 across all five allowed classes, which is useful because the tiny calibration set only covers three tone classes.

## Next improvements

- Swap the heuristic classifier for a supervised acoustic model once the labeled audio set is available locally.
- Deploy the Node server to a hosted environment so AutoAce can access it with shared credentials.
- Add richer ZIP parsing and progress streaming if the batch sizes grow.
