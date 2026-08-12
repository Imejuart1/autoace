# Technical Memo

## Executive Summary

The final system is a privacy-conscious hybrid pipeline rather than a single classifier. Browser-side signal analysis and YAMNet handle technical audio fields, while an authenticated Vercel endpoint applies a pretrained speech-emotion model and local Whisper transcription to selected speech segments. The architecture uses no paid model API, preserves the required schema, isolates per-file errors, and supports evaluator-operated batch processing.

The design intentionally does not use filenames or manifest labels during inference. A supplied `result_json` is read only after predictions exist so the dashboard can display optional validation metrics.

## Approaches Considered

### 1. Deterministic acoustic baseline

The first approach used energy, pitch, pitch variation, pauses, spectral balance, clipping, and silence thresholds. It was inexpensive and reproducible, but emotional tone and semantic noise type were too ambiguous when inferred from aggregate signal statistics alone.

### 2. Pretrained acoustic emotion model

`onnx-community/Speech-Emotion-Classification-ONNX` adds learned evidence for broad neutral, angry, happy, and sad classes. This materially improves robustness over loudness-only tone rules, but its taxonomy does not directly represent all five AutoAce labels.

### 3. Local transcription and semantic evidence

Whisper Tiny provides wording evidence for explicit dissatisfaction, confrontation, profanity, panic, appreciation, relief, and negation. Automatic language routing uses the English model for English and the multilingual model with translation for other detected languages. Transcript evidence affects emotional tone only, never noise or technical quality.

### 4. Learned environmental-event detection

YAMNet provides AudioSet event scores for background sounds. Scores are grouped into concise operational categories such as `TV`, `sharp static`, music, office chatter, road noise, wind, and mechanical noise. Event strength, temporal activity, dominance over competing events, and independent acoustic measurements are fused to avoid treating every artifact as meaningful noise.

### 5. Frame-level overlap detection

The original whole-call overlap proxy was replaced. Independent stereo uses simultaneous voice activity, energy balance, and inter-channel correlation to reject duplicate audio and crosstalk. Mono and duplicate dual-mono use stable, non-harmonic dual-pitch spectral evidence. A positive result requires at least 300 ms of continuous evidence and 400 ms total evidence.

## Final Architecture

1. The evaluator signs in through an HttpOnly session cookie.
2. The browser validates folder, ZIP, single-file, and manifest inputs.
3. Each valid clip is decoded independently; one failure does not cancel the batch.
4. Browser analysis computes technical features, YAMNet events, overlap, silence, and quality.
5. Representative high-energy speech segments are resampled to 16 kHz.
6. Selected segments are sent to the authenticated `/api/tone` endpoint.
7. The endpoint runs emotion classification, language detection, and transcription locally in the Vercel Node runtime.
8. Acoustic, pretrained, and semantic evidence are fused into the required tone and intensity enums.
9. Results are validated against the output schema, rendered, and made downloadable as CSV or JSON.

## Reproducibility and Leakage Control

- The implementation runs from `npm ci` and `npm start` on Node.js 18 or newer.
- Model identifiers and quantization types have deterministic defaults and environment-variable overrides.
- Browser-side YAMNet and ONNX Runtime assets are versioned with the repository.
- Manifest labels and filenames are excluded from feature extraction and model fusion.
- Validation happens only after inference.
- Technical audio fields remain independent from transcript sentiment.
- Automated regressions cover decision rules and synthetic overlap cases without using hidden data.

## Validation

The dashboard implements:

- tone accuracy
- macro F1 across the five tone labels
- macro F1 across observed truth classes
- field accuracy for tone, intensity, noise presence, noise severity, quality, overlap, and long silence
- a five-class tone confusion matrix

These metrics are computed only when the evaluator supplies ground truth. With only three example calls, reporting those values as an estimate of unseen-call performance would be statistically misleading. Therefore, this submission makes no hidden-set accuracy claim and does not present training/example agreement as generalization evidence.

For a larger labeled corpus, the recommended protocol is grouped cross-validation by call, caller, and speaker, with duplicate-audio fingerprinting before splitting. Confidence calibration should be fitted only on held-out groups.

## Cost Analysis

### Paid model/API charge

- YAMNet, acoustic analysis, overlap, silence, and quality run in the evaluator's browser.
- Emotion and Whisper models are open-weight models executed inside the application runtime.
- No paid inference or LLM API is called.
- Direct paid model/API charge: `$0.0000` per audio minute.

### Infrastructure estimate

The hosted endpoint analyzes selected speech segments rather than every sample of a long call. Vercel Fluid Compute bills Active CPU, provisioned memory, and invocations. As of August 12, 2026, published prices start at `$0.128` per Active CPU hour, `$0.0106` per GB-hour, and `$0.60` per million invocations. A standard function uses 2 GB and 1 vCPU.

Source: https://vercel.com/docs/functions/usage-and-pricing

One measured three-call run contained `3.96` audio minutes and completed in `62.59 s`, or `15.79 s` wall time per audio minute. Treating every one of those seconds as billed server-side Active CPU is deliberately conservative because browser analysis is not Vercel compute and CPU billing pauses during I/O.

At the starting regional price:

```text
CPU and memory rate = $0.128 + (2 GB x $0.0106) = $0.1492/hour
compute cost/minute = (15.79 / 3600) x $0.1492 = $0.000654
maximum measured-batch invocations/minute = 30 / 3.96 = 7.58
invocation cost/minute = 7.58 x ($0.60 / 1,000,000) = $0.000005
conservative total = $0.000659 per audio minute
```

Using the highest listed regional rates instead (`$0.221` CPU and `$0.0183` per GB-hour), the same conservative calculation is approximately `$0.001135` per audio minute. Both estimates are below the `$0.003` ceiling before plan-included usage is applied. Actual cost depends on region, concurrency, cold starts, selected segment count, and hosting plan; Vercel Observability remains the billing source of truth.

The deployed dashboard reports wall time and seconds per audio minute for each batch so this estimate can be recomputed under the active hosting plan. A production rollout should monitor billed function duration and enforce a segment budget if the observed all-in value approaches `$0.003` per audio minute.

Model downloads and cold initialization are operational overhead and should be amortized or removed with a persistent model worker for sustained production volume.

## Latency Analysis

Measured development observations:

- Three-call batch: `3.96` audio minutes processed in `62.59 s`, or `15.79 s` per audio minute and approximately `3.8x` real time.
- Cached emotion plus Whisper inference for one selected 18-second segment: approximately `5.31 s` on the development machine.
- First uncached model download and initialization: approximately `69.8 s`.
- Browser YAMNet on a roughly 25-second clean sample: approximately `4.24 s` during isolated testing.
- Frame-level mono overlap analysis ranged from roughly `2.1 s` for a 31-second call to `15.9 s` for a 172-second call before a windowing optimization; current automated checks verify behavior, while production batch timing is displayed live by the dashboard.

Warm latency is suitable for batch review, but cold starts remain the main operational risk. For production scale, models should be prewarmed or moved to a persistent inference worker.

## Privacy and Data Handling

- Full audio remains in the evaluator's browser for technical analysis.
- Only selected speech segments reach the authenticated application endpoint.
- No audio is sent to an LLM, paid inference service, or public file host.
- The implementation does not intentionally persist uploaded audio or transcripts.
- Model downloads originate from Hugging Face on first server-side use; audio is not uploaded there.

## Failure Handling

- Unsupported or malformed files fail independently.
- Missing manifest rows and missing audio files are reported clearly.
- If the learned tone endpoint is unavailable, the app records the fallback and retains acoustic output.
- If YAMNet cannot initialize, noise analysis falls back to deterministic acoustic evidence.
- Downloads contain successful predictions and identify failed files in diagnostics.

## Limitations

- The emotion model is not trained specifically on dealership service calls.
- Customer-versus-staff role selection is automatic but is not full diarization.
- Similar-pitch speakers and background media can challenge mono overlap detection.
- Quiet noise can be masked by foreground speech.
- TV, radio, and nearby chatter are semantically adjacent event classes.
- Telecom impairments such as packet loss, codec warble, and echo use proxy features rather than a specialized quality model.
- Sarcasm, indirect language, transcription errors, and code-switching can affect tone.
- The confidence value is a bounded evidence score, not a statistically calibrated probability.
- Browser codec support varies, especially for uncommon containers.

## Next Steps

1. Build a larger, speaker-grouped dealership-call validation set.
2. Add audio fingerprinting and grouped cross-validation tooling.
3. Calibrate confidence on held-out calls.
4. Add true diarization and customer-role classification for mono calls.
5. Add a dedicated telecom-quality model for echo, packet loss, and robotic speech.
6. Move server-side models to a persistent warm worker for lower cold-start latency and predictable infrastructure cost.
7. Monitor field-level drift and permit threshold updates only from versioned validation experiments.
