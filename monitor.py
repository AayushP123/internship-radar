#!/usr/bin/env python3
"""Fast, dependency-free software internship monitor."""

from __future__ import annotations

import argparse
import concurrent.futures
import hashlib
import html
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, asdict
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any, Iterable


ROOT = Path(__file__).resolve().parent
DEFAULT_CONFIG = ROOT / "config.json"
DEFAULT_COMPANIES = ROOT / "companies.json"
DEFAULT_STATE = ROOT / "state.json"
USER_AGENT = "InternshipRadar/1.0 (+personal job-alert monitor)"
HTML_TAG = re.compile(r"<[^>]+>")
SPACE = re.compile(r"\s+")
MARKDOWN_LINK = re.compile(r"\[([^\]]+)\]\((https?://[^)]+)\)")
HTML_LINK = re.compile(r'href=["\'](https?://[^"\']+)["\']', re.I)


@dataclass(frozen=True)
class Job:
    source: str
    company: str
    title: str
    location: str
    url: str
    posted_at: str = ""
    description: str = ""

    @property
    def fingerprint(self) -> str:
        stable = "|".join(
            [
                normalize(self.company),
                normalize(self.title),
                normalize(self.location),
                canonical_url(self.url),
            ]
        )
        return hashlib.sha256(stable.encode("utf-8")).hexdigest()[:24]


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def normalize(value: Any) -> str:
    text = html.unescape(str(value or ""))
    text = HTML_TAG.sub(" ", text)
    return SPACE.sub(" ", text).strip().lower()


def clean(value: Any) -> str:
    text = html.unescape(str(value or ""))
    text = HTML_TAG.sub(" ", text)
    return SPACE.sub(" ", text).strip()


def canonical_url(url: str) -> str:
    try:
        parsed = urllib.parse.urlsplit(url)
        query = urllib.parse.parse_qsl(parsed.query, keep_blank_values=True)
        query = [(k, v) for k, v in query if not k.lower().startswith(("utm_", "gh_", "lever-"))]
        return urllib.parse.urlunsplit(
            (parsed.scheme.lower(), parsed.netloc.lower(), parsed.path.rstrip("/"), urllib.parse.urlencode(query), "")
        )
    except ValueError:
        return url


def request_bytes(
    url: str,
    *,
    method: str = "GET",
    body: bytes | None = None,
    headers: dict[str, str] | None = None,
    timeout: int = 18,
    attempts: int = 2,
) -> bytes:
    merged = {"User-Agent": USER_AGENT, "Accept": "application/json,text/plain,text/markdown,*/*"}
    merged.update(headers or {})
    last_error: Exception | None = None
    for attempt in range(attempts):
        try:
            req = urllib.request.Request(url, data=body, headers=merged, method=method)
            with urllib.request.urlopen(req, timeout=timeout) as response:
                return response.read()
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError) as exc:
            last_error = exc
            if attempt + 1 < attempts:
                time.sleep(0.6 * (attempt + 1))
    assert last_error is not None
    raise last_error


def request_json(url: str, **kwargs: Any) -> Any:
    return json.loads(request_bytes(url, **kwargs).decode("utf-8"))


def fetch_greenhouse(company: dict[str, Any]) -> list[Job]:
    token = urllib.parse.quote(company["slug"])
    data = request_json(f"https://boards-api.greenhouse.io/v1/boards/{token}/jobs?content=true")
    return [
        Job(
            source="greenhouse",
            company=company["name"],
            title=clean(item.get("title")),
            location=clean((item.get("location") or {}).get("name")),
            url=item.get("absolute_url") or f"https://boards.greenhouse.io/{token}/jobs/{item.get('id')}",
            posted_at=item.get("updated_at") or "",
            description=clean(item.get("content")),
        )
        for item in data.get("jobs", [])
        if item.get("title")
    ]


def fetch_lever(company: dict[str, Any]) -> list[Job]:
    slug = urllib.parse.quote(company["slug"])
    data = request_json(f"https://api.lever.co/v0/postings/{slug}?mode=json")
    jobs: list[Job] = []
    for item in data:
        categories = item.get("categories") or {}
        location = categories.get("location") or item.get("workplaceType") or ""
        jobs.append(
            Job(
                source="lever",
                company=company["name"],
                title=clean(item.get("text")),
                location=clean(location),
                url=item.get("hostedUrl") or item.get("applyUrl") or "",
                posted_at=str(item.get("createdAt") or ""),
                description=clean(item.get("descriptionPlain") or item.get("description")),
            )
        )
    return jobs


def fetch_ashby(company: dict[str, Any]) -> list[Job]:
    slug = urllib.parse.quote(company["slug"])
    data = request_json(f"https://api.ashbyhq.com/posting-api/job-board/{slug}")
    jobs: list[Job] = []
    for item in data.get("jobs", []):
        location = item.get("location") or ""
        if item.get("isRemote") and "remote" not in normalize(location):
            location = f"{location} / Remote".strip(" /")
        jobs.append(
            Job(
                source="ashby",
                company=company["name"],
                title=clean(item.get("title")),
                location=clean(location),
                url=item.get("jobUrl") or item.get("applyUrl") or "",
                posted_at=item.get("publishedAt") or "",
                description=clean(item.get("descriptionPlain") or item.get("descriptionHtml")),
            )
        )
    return jobs


def fetch_simplify(repo: dict[str, Any]) -> list[Job]:
    branch = repo.get("branch", "dev")
    filename = repo.get("file", "README.md")
    url = f"https://raw.githubusercontent.com/{repo['repo']}/{branch}/{filename}"
    text = request_bytes(url).decode("utf-8", errors="replace")
    jobs: list[Job] = []
    for line in text.splitlines():
        if not line.startswith("|") or line.count("|") < 4:
            continue
        cells = [cell.strip() for cell in line.strip("|").split("|")]
        if len(cells) < 4 or set(cells[0]) <= {"-", ":", " "}:
            continue
        combined = " ".join(cells)
        md_links = MARKDOWN_LINK.findall(combined)
        html_links = HTML_LINK.findall(combined)
        links = [url for _, url in md_links] + html_links
        apply_links = [
            link
            for link in links
            if not any(host in link for host in ("simplify.jobs", "github.com/SimplifyJobs"))
        ]
        if not apply_links:
            apply_links = links
        if not apply_links:
            continue
        company_name = clean(re.sub(r"!\[[^\]]*\]\([^)]*\)", "", cells[0]))
        company_name = clean(re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", company_name))
        title = clean(re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", cells[1] if len(cells) > 1 else ""))
        location = clean(cells[2] if len(cells) > 2 else "")
        posted = clean(cells[-1])
        if company_name.lower() in {"company", "↳"} or title.lower() in {"role", "position"}:
            continue
        jobs.append(
            Job(
                source=f"github:{repo['repo']}",
                company=company_name or "Unknown company",
                title=title,
                location=location,
                url=html.unescape(apply_links[-1]),
                posted_at=posted,
            )
        )
    return jobs


PROVIDERS = {
    "greenhouse": fetch_greenhouse,
    "lever": fetch_lever,
    "ashby": fetch_ashby,
}


def contains_term(text: str, term: str) -> bool:
    needle = normalize(term)
    if " " not in needle and needle.isalnum():
        return bool(re.search(rf"\b{re.escape(needle)}\b", text))
    return needle in text


def includes_any(text: str, terms: Iterable[str]) -> bool:
    return any(contains_term(text, term) for term in terms)


def matches(job: Job, filters: dict[str, Any], allow_companies: set[str]) -> bool:
    title = normalize(job.title)
    location = normalize(job.location)

    # Requiring both concepts in the title avoids false positives from generic
    # descriptions that mention internship programs or software teams.
    if not includes_any(title, filters["internship_terms"]):
        return False
    if not includes_any(title, filters["role_terms"]):
        return False
    if includes_any(title, filters.get("exclude_title_terms", [])):
        return False
    if location and includes_any(location, filters.get("exclude_location_terms", [])):
        return False

    # Curated direct boards always pass company selection. Aggregator items must
    # belong to the same curated set (with forgiving punctuation matching).
    if job.source.startswith("github:") and allow_companies:
        normalized_company = normalize(job.company)
        if not any(name in normalized_company or normalized_company in name for name in allow_companies):
            return False

    location_terms = filters.get("location_terms", [])
    if location_terms and location:
        if not includes_any(location, location_terms):
            return False
    return bool(job.url)


def fetch_source(item: dict[str, Any]) -> tuple[list[Job], str | None]:
    try:
        return PROVIDERS[item["provider"]](item), None
    except Exception as exc:
        return [], f"{item['name']} ({item['provider']}:{item['slug']}): {exc}"


def fetch_repo(item: dict[str, Any]) -> tuple[list[Job], str | None]:
    try:
        return fetch_simplify(item), None
    except Exception as exc:
        if item.get("optional") and isinstance(exc, urllib.error.HTTPError) and exc.code == 404:
            return [], None
        return [], f"{item['repo']}: {exc}"


def notify_ntfy(topic: str, job: Job, priority: int = 4) -> None:
    if not topic:
        raise RuntimeError("NTFY_TOPIC is not configured")
    message = f"{job.company} — {job.title}\n{job.location or 'Location not listed'}\n{job.url}"
    headers = {
        "Title": "New SWE internship",
        "Priority": str(priority),
        "Tags": "computer,briefcase",
        "Click": job.url,
        "Actions": f"view, Apply, {job.url}",
        "Content-Type": "text/plain; charset=utf-8",
    }
    request_bytes(
        f"https://ntfy.sh/{urllib.parse.quote(topic)}",
        method="POST",
        body=message.encode("utf-8"),
        headers=headers,
        attempts=3,
    )


def send_test(topic: str) -> None:
    message = (
        "Notifications are working.\n\n"
        "This is only a test—there is no job attached. Real alerts show the "
        "company, role, and location, and tapping them opens the application."
    )
    request_bytes(
        f"https://ntfy.sh/{urllib.parse.quote(topic)}",
        method="POST",
        body=message.encode("utf-8"),
        headers={
            "Title": "Internship Radar test",
            "Priority": "4",
            "Tags": "white_check_mark",
            "Content-Type": "text/plain; charset=utf-8",
        },
        attempts=3,
    )
    print(f"Test notification sent to https://ntfy.sh/{topic}")


def read_json(path: Path, fallback: Any) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return fallback


def save_state(path: Path, state: dict[str, Any]) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(state, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    os.replace(tmp, path)


def run_once(
    config_path: Path,
    companies_path: Path,
    state_path: Path,
    *,
    dry_run: bool = False,
    send_current: bool = False,
) -> int:
    config = read_json(config_path, {})
    company_catalog = read_json(companies_path, [])
    companies = [item for item in company_catalog if item.get("enabled", True)]
    state = read_json(state_path, {"initialized": False, "seen": {}})
    state.setdefault("seen", {})
    seen_before = dict(state["seen"])
    topic = os.getenv("NTFY_TOPIC") or config["notifications"]["ntfy_topic"]
    allow_companies = {
        normalize(name)
        for item in company_catalog
        for name in [item["name"], *item.get("aliases", [])]
    }

    all_jobs: list[Job] = []
    errors: list[str] = []
    workers = min(config.get("max_workers", 24), max(1, len(companies)))
    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as pool:
        futures = [pool.submit(fetch_source, item) for item in companies]
        futures += [pool.submit(fetch_repo, item) for item in config.get("fallback_repositories", [])]
        for future in concurrent.futures.as_completed(futures):
            jobs, error = future.result()
            all_jobs.extend(jobs)
            if error:
                errors.append(error)

    matched_by_id = {
        job.fingerprint: job
        for job in all_jobs
        if matches(job, config["filters"], allow_companies)
    }
    first_run = not state.get("initialized", False)
    new_jobs = (
        list(matched_by_id.values())
        if send_current
        else [job for key, job in matched_by_id.items() if key not in state["seen"]]
    )
    new_jobs.sort(key=lambda job: (normalize(job.company), normalize(job.title)))

    if first_run and config.get("seed_without_alerting", True) and not send_current:
        print(f"Seeded {len(matched_by_id)} existing matching jobs without alerting.")
    else:
        cap = int(config.get("max_alerts_per_run", 20))
        for job in new_jobs[:cap]:
            if dry_run:
                print(f"DRY RUN: {job.company} | {job.title} | {job.location} | {job.url}")
            else:
                notify_ntfy(topic, job, int(config["notifications"].get("priority", 4)))
                print(f"ALERT: {job.company} | {job.title} | {job.location}")
        if len(new_jobs) > cap:
            print(f"Suppressed {len(new_jobs) - cap} extra alerts (safety cap={cap}).")

    timestamp = now_iso()
    for key in matched_by_id:
        state["seen"][key] = state["seen"].get(key, timestamp)
    retention = datetime.now(timezone.utc) - timedelta(days=int(config.get("state_retention_days", 400)))
    state["seen"] = {
        key: seen_at
        for key, seen_at in state["seen"].items()
        if _parse_time(seen_at) >= retention
    }
    state.update(
        {
            "initialized": True,
            "last_run": timestamp,
            "last_total_jobs": len(all_jobs),
            "last_matching_jobs": len(matched_by_id),
            "last_new_jobs": len(new_jobs),
            "last_source_errors": errors[:50],
        }
    )
    seen_changed = state["seen"] != seen_before
    persist_only_on_change = os.getenv("PERSIST_ONLY_ON_CHANGE") == "1"
    if not dry_run and (not persist_only_on_change or seen_changed or first_run):
        save_state(state_path, state)

    print(
        f"Checked {len(companies)} company boards; fetched {len(all_jobs)} jobs; "
        f"matched {len(matched_by_id)} internships; new {len(new_jobs)}; source errors {len(errors)}."
    )
    for error in errors[:8]:
        print(f"WARN: {error}", file=sys.stderr)
    return 0


def _parse_time(value: str) -> datetime:
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return datetime.now(timezone.utc)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    parser.add_argument("--companies", type=Path, default=DEFAULT_COMPANIES)
    parser.add_argument("--state", type=Path, default=DEFAULT_STATE)
    parser.add_argument("--loop", action="store_true", help="Run continuously.")
    parser.add_argument("--interval", type=int, default=120, help="Loop interval in seconds.")
    parser.add_argument("--dry-run", action="store_true", help="Print alerts without sending or saving.")
    parser.add_argument("--test-notification", action="store_true")
    parser.add_argument(
        "--send-current",
        action="store_true",
        help="Send every currently matching job, even if it has already been seen.",
    )
    args = parser.parse_args()

    config = read_json(args.config, {})
    if args.test_notification:
        topic = os.getenv("NTFY_TOPIC") or config["notifications"]["ntfy_topic"]
        send_test(topic)
        return 0
    if not args.loop:
        return run_once(
            args.config,
            args.companies,
            args.state,
            dry_run=args.dry_run,
            send_current=args.send_current,
        )

    while True:
        started = time.monotonic()
        try:
            run_once(args.config, args.companies, args.state, dry_run=args.dry_run)
        except KeyboardInterrupt:
            return 0
        except Exception as exc:
            print(f"Monitor run failed: {exc}", file=sys.stderr)
        elapsed = time.monotonic() - started
        time.sleep(max(5, args.interval - elapsed))


if __name__ == "__main__":
    raise SystemExit(main())
