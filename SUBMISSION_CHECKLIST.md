# Submission Checklist

## Evaluator Access

- Hosted URL: https://autoace-trial-dashboard.vercel.app
- Username: `autoace`
- Password: `AutoAce2026!`
- Login tested in a signed-out browser session
- `/home` redirects unauthenticated users to `/login`

## Required Deliverables

- Hosted authenticated dashboard
- Single-file, folder, and ZIP upload
- Optional manifest upload
- Missing/unmatched-file validation
- Batch progress and per-file errors
- Required structured output schema
- Results table
- Downloadable CSV and JSON
- Optional validation metrics and confusion matrix
- Runtime summary
- Cost disclosure
- Technical memo
- Setup and deployment instructions
- Third-party model notice
- Security and dependency-risk note

## Final Verification

- Run `npm ci`
- Run `npm test`
- Run `npm start` and test `/login` and `/home`
- Test one unlabeled single clip
- Test one unlabeled ZIP batch
- Confirm a malformed file does not stop valid files
- Confirm downloaded CSV uses `name,result_json`
- Confirm JSON preserves original filenames
- Confirm `background_noise_type` is empty when noise is absent
- Confirm all enum values match the trial specification
- Confirm the hosted Operations panel does not report an unexpected fallback
- Hard-refresh the production site after the final deployment

## Submission Package

- Production URL and credentials
- Git repository URL
- `README.md`
- `TECHNICAL_MEMO.md`
- `THIRD_PARTY_NOTICES.md`
- `PROVIDED_CALL_PREDICTIONS.json`
- Predictions exported from the final deployed build

## Claims to Avoid

- Do not claim hidden-set accuracy.
- Do not describe three example calls as statistically valid validation.
- Do not claim confidence is a calibrated probability.
- Do not describe `$0.0000` paid API cost as zero infrastructure cost.
- Do not claim mono overlap or customer-role detection is perfect.
