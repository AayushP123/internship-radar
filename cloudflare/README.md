# Cloudflare scheduler

This Worker is the reliable cloud runtime for Internship Radar.

- One minutely cron rotates through four catalog shards.
- Every company is checked every four minutes.
- Cloudflare KV stores deduplication state.
- `NTFY_TOPIC` is an encrypted Worker secret.
- `/status` shows the last run of every shard without exposing secrets or jobs.
