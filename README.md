# Internship Radar

Internship Radar checks **135 live company job feeds** every two minutes on
Windows (or every five minutes with GitHub Actions), filters for US/remote
software engineering internships, deduplicates results, and sends push
notifications through ntfy.

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
- deduplication in `state.json`

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

## Run in the cloud

Keep the repository **private**, push this folder to GitHub, and Actions will
check every five minutes. Add an Actions secret named `NTFY_TOPIC` with your
private topic. The workflow persists `state.json` whenever new jobs are found.

For checks closer to two minutes, deploy the included `Dockerfile` as an
always-on background worker and set `NTFY_TOPIC` as an environment variable.
