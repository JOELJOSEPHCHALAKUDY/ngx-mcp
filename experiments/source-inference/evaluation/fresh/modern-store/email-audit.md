# Frozen email-label audit

The original labels remain frozen. An independent browser audit on 2026-11-09 found that `format: "email"` in the source labels is an approximation when interpreted using ajv-formats default/full mode. Native email input validation and Angular Validators.email both accept `a@b`, `a@localhost` and `user@example`; ajv-formats full rejects those values. Its fast mode accepts them but also accepts `a..b@example.com`, which Angular rejects. Switching format mode does not exactly reproduce source behavior.

The audit used DOM typing into the unmodified SignInDialog and read native `checkValidity()` plus the existing Angular email control errors. No form submission, account or external request occurred. JSON observations are in email-audit.json. Treat these differences as frozen ground-truth schema approximation errors; do not change labels to match compiler output.
