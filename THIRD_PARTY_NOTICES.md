# Third-Party Model Notice

The browser-side environmental sound classifier uses YAMNet, originally published by Google and TensorFlow under the Apache License 2.0. YAMNet predicts 521 AudioSet event classes. This repository self-hosts an ONNX conversion of the official model for private, local browser inference.

- Upstream implementation: https://github.com/tensorflow/models/tree/master/research/audioset/yamnet
- ONNX mirror: https://huggingface.co/andrelgomes/yamnet-onnx
- Runtime: ONNX Runtime Web, MIT License
