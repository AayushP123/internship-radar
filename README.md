# Internship Radar

Internship Radar covers **2,592 companies** through 135 live direct company
job feeds plus maintained broad-market internship feeds. Cloudflare Workers
filter for US/remote software engineering internships, deduplicate results,
and send push notifications through ntfy.

Live health:
https://internship-radar.aayush-internship-radar-7f3b.workers.dev/status

The direct ATS catalog contains 220 companies, with 135 currently live.
Companies without a working direct ATS mapping remain covered through the
maintained SimplifyJobs active and off-season feeds.

## Get notifications

Install the free **ntfy** app on iOS or Android, then subscribe to the private
topic supplied separately. Treat that topic name like a password.

## What is already configured

- 2,592-company coverage catalog
- 135 live direct feeds across Greenhouse, Ashby, and Lever
- maintained active and off-season broad-market feeds
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
python build_company_catalog.py
```

The Windows scheduled task can be installed or removed with:

```powershell
.\install_windows_task.ps1
.\uninstall_windows_task.ps1
```

## Cloud runtime

The production runtime is in `cloudflare/`. A delayed Cloudflare Queue message
rotates through four shards, checking every live direct company feed once per
four minutes. The broad-market feeds are also ingested during each full cycle.
Queue retries recover transient failures automatically. `NTFY_TOPIC` is stored
as an encrypted Worker secret.

GitHub Actions remains available for manual diagnostic runs. The included
Windows task and Dockerfile are optional local fallbacks.
