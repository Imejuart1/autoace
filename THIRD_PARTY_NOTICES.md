# Third-Party Model Notice

## YAMNet

The browser-side environmental sound classifier uses YAMNet, originally published by Google and TensorFlow under the Apache License 2.0. YAMNet predicts 521 AudioSet event classes. This repository self-hosts an ONNX conversion of the official model for private, local browser inference.

- Upstream implementation: https://github.com/tensorflow/models/tree/master/research/audioset/yamnet
- ONNX mirror: https://huggingface.co/andrelgomes/yamnet-onnx
- Runtime: ONNX Runtime Web, MIT License

## Speech Emotion Classification

The hosted tone endpoint uses `onnx-community/Speech-Emotion-Classification-ONNX`, an ONNX conversion of `prithivMLmods/Speech-Emotion-Classification`. The base model is licensed under Apache License 2.0.

- ONNX model: https://huggingface.co/onnx-community/Speech-Emotion-Classification-ONNX
- Base model: https://huggingface.co/prithivMLmods/Speech-Emotion-Classification

## Whisper Tiny

The hosted semantic component uses ONNX conversions of OpenAI Whisper Tiny and Whisper Tiny English. The source Whisper checkpoints are licensed under Apache License 2.0.

- English ONNX model: https://huggingface.co/onnx-community/whisper-tiny.en
- Multilingual ONNX model: https://huggingface.co/onnx-community/whisper-tiny
- Source models: https://huggingface.co/openai/whisper-tiny and https://huggingface.co/openai/whisper-tiny.en

## JavaScript Runtimes

- Transformers.js: Apache License 2.0
- ONNX Runtime Web: MIT License

The remote model repositories provide model files to the application runtime. Uploaded customer audio is not sent to Hugging Face.
