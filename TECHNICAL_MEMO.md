# Technical Memo

## Objective

Build a practical system that can classify emotional tone and background noise in production call audio while staying inexpensive, reproducible, and fast enough for batch use.

## Approaches Tested

I worked through three stages:

1. A simple baseline using energy, pitch, and pause thresholds.
2. A refined hybrid heuristic that added:
   - segment density
   - silence duration
   - spectral-band balance
   - transient noise cues
   - overlap proxies
3. A hybrid model path that combines the acoustic baseline with Vercel-hosted pretrained Wav2Vec2 emotion evidence from Transformers.js.

The hybrid architecture retains the deterministic checks for audio quality, overlap, silence, and noise while using the pretrained model only as high-confidence tone evidence. This preserves privacy and keeps model-inference cost effectively zero when self-hosted.

## Final Architecture

- The hosted dashboard runs entirely on Vercel.
- The dashboard is protected by a real session cookie and shared credentials.
- The manifest CSV is validated in-browser.
- Audio is decoded client-side and converted to mono samples.
- Short-frame waveform and spectral features are extracted.
- High-energy 18-second audio segments are resampled to 16 kHz and sent to the `/api/tone` endpoint, which runs a Transformers.js emotion classifier in the Vercel Node runtime.
- The model's four broad outputs (`neutral`, `angry`, `happy`, `sad`) are fused conservatively with the acoustic baseline to produce the required AutoAce tone labels.
- Deterministic rules produce the required output schema:
  - emotional tone
  - emotional intensity
  - background noise presence and type
  - background noise severity
  - audio quality
  - speaker overlap
  - long silence
  - confidence
- Results are displayed, validated, and downloadable as JSON or CSV.

## Validation Results

On the provided three labeled calls, the latest calibrated pass matches all three labels:

- Tone macro F1 (observed classes): `1.000`
- Tone macro F1 (all five classes): `0.600`
- Tone accuracy: `1.000`
- Noise accuracy: `1.000`
- Quality accuracy: `1.000`
- Overlap accuracy: `1.000`
- Silence accuracy: `1.000`

Confusion matrix:

- `upset -> upset`
- `neutral -> neutral`
- `satisfied -> satisfied`

## Cost Analysis

- The hybrid inference path uses no paid external API.
- Estimated model-inference cost: `$0.0000` per audio minute.
- Assumption: the dashboard and model inference both run inside Vercel, with the model downloaded on first use and cached by the runtime.
- This remains comfortably below the `$0.003` per audio minute ceiling.

## Latency Analysis

Measured on the three labeled sample calls:

- Total wall time: about `13.27 s`
- Total audio: about `3.96 min`
- Throughput: about `3.35 s` per audio minute
- Equivalent speed: about `17.9x` real time on this machine

The baseline runtime is dominated by client-side decoding and feature extraction. The hybrid model adds CPU inference time per selected 18-second segment; measure this separately in the Vercel runtime after deployment.

## Failure Modes and Limitations

- The system can still confuse neutral and satisfied speech when pitch and speech energy are similar.
- Background-noise labels are heuristic and can overfit to spectral patterns that are not truly semantic noise categories.
- Long-silence detection can be brittle on very long recordings with natural pauses.
- The pretrained emotion model was trained on broad IEMOCAP emotions rather than the AutoAce label taxonomy. It should be calibrated on a larger dealership-call set before reporting generalization claims.
- Customer-only tone requires diarization or speaker-role identification; the current implementation does not yet isolate the customer from other speakers.

## Next Steps

1. Measure the hybrid model against the three provided labeled calls and preserve only changes that improve leave-one-call-out behavior.
2. Collect additional dealer-call labels and calibrate the five-class mapping on grouped validation folds.
3. Add speaker diarization to isolate the customer before tone scoring.
4. Keep the full stack on Vercel and refine the model-label calibration as more data becomes available.
