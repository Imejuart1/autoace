# Security Notes

## Data Flow

- Full uploaded audio is decoded in the evaluator's browser.
- Only selected speech segments are sent to the authenticated `/api/tone` endpoint.
- Uploaded audio and transcripts are not intentionally persisted.
- No audio is sent to an LLM, paid inference API, or public file-upload service.

## Authentication

Production deployments should define `AUTOACE_USERNAME`, `AUTOACE_PASSWORD`, and a long random `AUTOACE_AUTH_SECRET`. Set `AUTOACE_COOKIE_SECURE=1` on HTTPS deployments. Evaluator credentials should be rotated after the assessment period.

Sessions are signed, expiring HttpOnly cookies rather than process-memory records, so authentication remains stable across serverless instances. Production Vercel deployments mark the cookie `Secure` automatically.

## Dependency Advisory

At the time of submission, `npm audit` reports a high-severity advisory inherited through `@huggingface/transformers -> sharp -> libvips` (`GHSA-f88m-g3jw-g9cj`). npm reports no compatible automated fix.

This application uses Transformers.js only for audio classification and speech recognition; it does not invoke `sharp` or process uploaded images. The vulnerable image-decoding path is therefore outside the application's request flow. This is a scoped residual supply-chain risk, not a claim that the dependency is vulnerability-free. Production follow-up should upgrade Transformers.js when it supports a patched `sharp` release and rerun audio-model regression tests.

## Reporting

Do not include production-call audio, transcripts, passwords, cookies, or signing secrets in an issue report. Rotate any credential that may have been exposed.
