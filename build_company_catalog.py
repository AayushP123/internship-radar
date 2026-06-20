#!/usr/bin/env python3
"""Build the broad company coverage catalog from maintained internship lists."""

from __future__ import annotations

import html
import json
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parent
WORK = ROOT / "work"
OUTPUT = ROOT / "tracked-companies.json"
COMPANY_LINK = re.compile(
    r'https://simplify\.jobs/c/[^"?]+[^>]*>([^<]+)</a>',
    re.IGNORECASE,
)


def clean_name(value: str) -> str:
    return re.sub(r"\s+", " ", html.unescape(value)).strip(" *")


def main() -> int:
    names: set[str] = set()
    source_files = sorted(WORK.glob("*.md"))
    if not source_files:
        raise SystemExit("No downloaded internship list files found in work/")

    for source in source_files:
        text = source.read_text(encoding="utf-8", errors="ignore")
        for match in COMPANY_LINK.finditer(text):
            name = clean_name(match.group(1))
            if name and name not in {"↳", "â†³"}:
                names.add(name)

    direct = json.loads((ROOT / "companies.json").read_text(encoding="utf-8"))
    names.update(item["name"].strip() for item in direct if item.get("name"))

    OUTPUT.write_text(
        json.dumps(sorted(names, key=str.casefold), indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"Wrote {len(names)} tracked companies to {OUTPUT.name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
