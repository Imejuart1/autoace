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
3. A hybrid model path that combines the acoustic baseline with Vercel-hosted pretrained emotion evidence from Transformers.js.
4. A semantic path using local Whisper transcription and conservative transcript-emotion rules.

The hybrid architecture retains deterministic checks for audio quality, overlap, silence, and noise. Pretrained acoustic emotion and local transcript semantics affect tone only. This preserves privacy and avoids paid inference APIs while keeping technical audio fields independent from transcript content.

## Final Architecture

- The hosted dashboard runs entirely on Vercel.
- The dashboard is protected by a real session cookie and shared credentials.
- The manifest CSV is validated in-browser.
- Audio is decoded client-side. Duplicate stereo is detected automatically; genuinely separated channels are ranked internally as customer candidates.
- Short-frame waveform and spectral features are extracted.
- High-energy 18-second audio segments are resampled to 16 kHz and sent to the authenticated `/api/tone` endpoint.
- The endpoint runs `onnx-community/Speech-Emotion-Classification-ONNX` plus automatic Whisper language routing in the Vercel Node runtime. Multilingual Whisper identifies the language; English uses `onnx-community/whisper-tiny.en`, while other supported languages use `onnx-community/whisper-tiny` with translation to English for semantic rules.
- The model's four broad outputs (`neutral`, `angry`, `happy`, `sad`) are fused conservatively with the acoustic baseline to produce the required AutoAce tone labels.
- Transcript rules account for explicit dissatisfaction, confrontation, profanity, panic, positive language, and negation. Transcript evidence never determines noise, quality, overlap, or silence.
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

The last measured three-call run before semantic fusion produced:

- Tone macro F1 (observed classes): `0.667`
- Tone macro F1 (all five classes): `0.400`
- Tone accuracy: `0.667`
- Noise accuracy: `1.000`
- Quality accuracy: `1.000`

The new semantic regression verifies that an acoustically `satisfied` prediction with the transcript "What do you mean ... Just fucking get back to me" resolves to `upset` with `high` intensity. Final three-call metrics must be regenerated after the semantic and overlap changes; no training-set or unmeasured 100% claim is reported.

## Cost Analysis

- The hybrid inference path uses no paid external model API.
- Model-license/API charge: `$0.0000` per audio minute.
- Vercel CPU and memory are infrastructure costs and must be estimated from measured invocation duration and the active Vercel plan before claiming total production cost.
- Audio never leaves the authenticated application endpoint for inference.

## Latency Analysis

Measured locally on one 18-second segment:

- Cached emotion plus transcription endpoint: about `5.31 s`
- First uncached model download and initialization: about `69.8 s`
- Vercel function timeout: `300 s` to tolerate cold initialization

The complete batch runtime must be remeasured after deployment because serverless cold starts and cache reuse materially affect latency.

## Failure Modes and Limitations

- The system can still confuse neutral and satisfied speech when pitch and speech energy are similar.
- Background-noise labels are heuristic and can overfit to spectral patterns that are not truly semantic noise categories.
- Long-silence detection can be brittle on very long recordings with natural pauses.
- The pretrained emotion model was trained on broad IEMOCAP emotions rather than the AutoAce label taxonomy. It should be calibrated on a larger dealership-call set before reporting generalization claims.
- Split stereo channels are ranked automatically, but mixed mono calls still lack guaranteed customer diarization.
- Whisper transcription errors, profanity recognition errors, sarcasm, and negation outside the covered patterns can still produce semantic mistakes.

## Next Steps

1. Measure the hybrid model against the three provided labeled calls and preserve only changes that improve leave-one-call-out behavior.
2. Collect additional dealer-call labels and calibrate the five-class mapping on grouped validation folds.
3. Add true speaker diarization and role classification for mixed mono calls.
4. Keep the full stack on Vercel and refine the model-label calibration as more data becomes available.
