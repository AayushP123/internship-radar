# Cloudflare scheduler

This Worker is the reliable cloud runtime for Internship Radar.

- Four independent cron Workers split the live company catalog into shards.
- Every company is checked every five minutes.
- Cloudflare KV stores deduplication state.
- `NTFY_TOPIC` is an encrypted Worker secret.
- `/status` shows the last run of every shard without exposing secrets or jobs.
