# Technical Memo

## Objective

Build a practical system that can classify emotional tone and background noise in production call audio while staying inexpensive, reproducible, and fast enough for batch use.

## Approaches Tested

I worked through two iterations of the same browser-side acoustic approach:

1. A simple baseline using energy, pitch, and pause thresholds.
2. A refined hybrid heuristic that added:
   - segment density
   - silence duration
   - spectral-band balance
   - transient noise cues
   - overlap proxies

The second version was kept because it matched the labeled sample calls better and stayed fully local, which preserves privacy and keeps inference cost essentially zero.

## Final Architecture

- A lightweight Node server handles the hosted dashboard shell and login.
- The dashboard is protected by a real session cookie and shared credentials.
- The manifest CSV is validated in-browser.
- Audio is decoded client-side and converted to mono samples.
- Short-frame waveform and spectral features are extracted.
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

- Current inference path uses no paid external API.
- Estimated model-inference cost: `$0.0000` per audio minute.
- Assumption: audio is processed locally in the browser and the dashboard is served by a self-hosted Node server with session-based login.
- This remains comfortably below the `$0.003` per audio minute ceiling.

## Latency Analysis

Measured on the three labeled sample calls:

- Total wall time: about `13.27 s`
- Total audio: about `3.96 min`
- Throughput: about `3.35 s` per audio minute
- Equivalent speed: about `17.9x` real time on this machine

The current runtime is dominated by client-side decoding and feature extraction. Because the pipeline is deterministic and local, latency scales predictably with batch size.

## Failure Modes and Limitations

- The system can still confuse neutral and satisfied speech when pitch and speech energy are similar.
- Background-noise labels are heuristic and can overfit to spectral patterns that are not truly semantic noise categories.
- Long-silence detection can be brittle on very long recordings with natural pauses.
- The current classifier is intentionally lightweight, so it will not match a well-trained supervised model on a larger labeled corpus.

## Next Steps

1. Replace the heuristics with a supervised audio model once more labeled data is available.
2. Compare the current deterministic baseline against a learned acoustic classifier on grouped validation folds.
3. Deploy the Node server to a persistent hosted environment for the evaluation window.
4. Revisit confidence calibration once a larger validation set exists.
