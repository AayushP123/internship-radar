# Cloudflare scheduler

This Worker is the reliable cloud runtime for Internship Radar.

- One delayed Queue message rotates through four catalog shards.
- Every company is checked every four minutes.
- Queue retries automatically recover transient failures.
- Cloudflare KV stores deduplication state.
- `NTFY_TOPIC` is an encrypted Worker secret.
- `/status` shows the last run of every shard without exposing secrets or jobs.
