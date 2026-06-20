#!/usr/bin/env python3
"""Validate configured ATS boards and disable confirmed 404 mappings."""

from __future__ import annotations

import concurrent.futures
import json
import urllib.error
from datetime import datetime, timezone
from pathlib import Path

from monitor import PROVIDERS


ROOT = Path(__file__).resolve().parent
COMPANIES = ROOT / "companies.json"
REPORT = ROOT / "source-validation.json"


def validate(item: dict) -> dict:
    try:
        jobs = PROVIDERS[item["provider"]](item)
        return {
            "name": item["name"],
            "provider": item["provider"],
            "slug": item["slug"],
            "status": "live",
            "job_count": len(jobs),
        }
    except urllib.error.HTTPError as exc:
        return {
            "name": item["name"],
            "provider": item["provider"],
            "slug": item["slug"],
            "status": "not_found" if exc.code == 404 else "transient_error",
            "error": f"HTTP {exc.code}",
        }
    except Exception as exc:
        return {
            "name": item["name"],
            "provider": item["provider"],
            "slug": item["slug"],
            "status": "transient_error",
            "error": str(exc),
        }


def main() -> int:
    companies = json.loads(COMPANIES.read_text(encoding="utf-8"))
    with concurrent.futures.ThreadPoolExecutor(max_workers=28) as pool:
        results = list(pool.map(validate, companies))

    by_key = {(r["provider"], r["slug"]): r for r in results}
    for item in companies:
        result = by_key[(item["provider"], item["slug"])]
        if result["status"] == "not_found":
            item["enabled"] = False
        elif result["status"] == "live":
            item.pop("enabled", None)

    report = {
        "validated_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "live": sum(r["status"] == "live" for r in results),
        "not_found": sum(r["status"] == "not_found" for r in results),
        "transient_errors": sum(r["status"] == "transient_error" for r in results),
        "results": sorted(results, key=lambda r: (r["status"], r["name"].lower())),
    }
    COMPANIES.write_text(json.dumps(companies, indent=2) + "\n", encoding="utf-8")
    REPORT.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(
        f"Live: {report['live']}; not found/disabled: {report['not_found']}; "
        f"transient errors left unchanged: {report['transient_errors']}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
