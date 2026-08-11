import base64
import os
import threading
from pathlib import Path

import numpy as np
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from transformers import pipeline


MODEL_ID = os.getenv("AUTOACE_TONE_MODEL", "superb/wav2vec2-base-superb-er")
MODEL_CACHE = Path(os.getenv("AUTOACE_MODEL_CACHE", ".model-cache")).resolve()
MAX_PCM_BYTES = 1_500_000
LABELS = ("neu", "ang", "hap", "sad")
LABEL_ALIASES = {
    "neu": "neu",
    "neutral": "neu",
    "ang": "ang",
    "angry": "ang",
    "hap": "hap",
    "happy": "hap",
    "sad": "sad",
}

app = FastAPI(title="AutoAce Local Tone Service", version="0.1.0")
model_lock = threading.Lock()
classifier = None


class ToneRequest(BaseModel):
    sample_rate: int = Field(ge=8000, le=48000)
    pcm16_base64: str = Field(min_length=4)
    duration_seconds: float = Field(ge=0, le=30)


def load_classifier():
    global classifier
    if classifier is not None:
        return classifier

    with model_lock:
        if classifier is None:
            MODEL_CACHE.mkdir(parents=True, exist_ok=True)
            classifier = pipeline(
                task="audio-classification",
                model=MODEL_ID,
                cache_dir=str(MODEL_CACHE),
                device=-1,
            )
    return classifier


def decode_pcm(request: ToneRequest) -> np.ndarray:
    try:
        raw = base64.b64decode(request.pcm16_base64, validate=True)
    except Exception as error:
        raise HTTPException(status_code=400, detail="pcm16_base64 must be valid base64 PCM audio.") from error

    if len(raw) > MAX_PCM_BYTES or len(raw) % 2:
        raise HTTPException(status_code=413, detail="Audio chunk is too large or malformed.")

    samples = np.frombuffer(raw, dtype="<i2").astype(np.float32) / 32768.0
    if not samples.size:
        raise HTTPException(status_code=400, detail="Audio chunk contains no samples.")
    return samples


def normalize_predictions(predictions) -> dict[str, float]:
    scores = {label: 0.0 for label in LABELS}
    for item in predictions or []:
        label = str(item.get("label", "")).strip().lower()
        mapped = LABEL_ALIASES.get(label)
        if mapped is None:
            continue
        scores[mapped] = max(scores[mapped], float(item.get("score", 0.0)))

    total = float(sum(scores.values()))
    if total <= 0:
        raise RuntimeError("Unexpected emotion model output.")

    return {label: value / total for label, value in scores.items()}


@app.get("/health")
def health():
    return {"ok": True, "model": MODEL_ID, "loaded": classifier is not None}


@app.post("/v1/tone")
def classify_tone(request: ToneRequest):
    samples = decode_pcm(request)
    try:
        active_classifier = load_classifier()
        with model_lock:
            predictions = active_classifier(
                {"array": samples.astype(np.float32), "sampling_rate": request.sample_rate},
                top_k=None,
            )
        scores = normalize_predictions(predictions)
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(status_code=503, detail=f"Emotion model unavailable: {error}") from error

    top_label, confidence = max(scores.items(), key=lambda item: item[1])
    return {
        "model": MODEL_ID,
        "labels": scores,
        "top_label": top_label,
        "confidence": round(confidence, 4),
    }
