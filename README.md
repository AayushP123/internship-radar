# Internship Radar

Internship Radar checks **135 live company job feeds** every five minutes on
Cloudflare Workers, filters for US/remote software engineering internships,
deduplicates results, and sends push notifications through ntfy.

Live health:
https://internship-radar.aayush-internship-radar-7f3b.workers.dev/status

The broader catalog contains 220 companies. Companies whose direct ATS mapping
is currently inactive remain eligible through the maintained SimplifyJobs
fallback feed.

## Get notifications

Install the free **ntfy** app on iOS or Android, then subscribe to the private
topic supplied separately. Treat that topic name like a password.

## What is already configured

- 135 live direct feeds across Greenhouse, Ashby, and Lever
- 220-company curated catalog
- US and remote location filtering
- software, backend, frontend, mobile, platform, ML, data, security, systems,
  firmware, embedded, DevOps, and quantitative-development internships
- quiet first run, so existing listings do not flood your phone
- cloud deduplication in Cloudflare KV

## Commands

```powershell
python monitor.py
python monitor.py --loop --interval 120
python monitor.py --test-notification
python monitor.py --send-current
python validate_sources.py
```

The Windows scheduled task can be installed or removed with:

```powershell
.\install_windows_task.ps1
.\uninstall_windows_task.ps1
```

## Cloud runtime

The production runtime is in `cloudflare/`. Four staggered cron shards check
every live company feed once per five minutes. `NTFY_TOPIC` is stored as an
encrypted Worker secret.

GitHub Actions remains available for manual diagnostic runs. The included
Windows task and Dockerfile are optional local fallbacks.
