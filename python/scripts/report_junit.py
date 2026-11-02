"""Emit GitHub check annotations for failing pytest cases.

CI job logs are not always retrievable, so failures are surfaced as workflow
commands (``::error``) that GitHub stores as check-run annotations. The
script reads a JUnit XML report and prints one annotation per failing or
erroring test case, falling back to the tail of the pytest log when the report
could not be produced (for example, on a collection error).
"""

from __future__ import annotations

import sys
import xml.etree.ElementTree as ET

MAX_REPORTED = 8
MAX_MESSAGE = 700
LOG_PATH = "/tmp/pytest.log"


def _one_line(value: str, limit: int = MAX_MESSAGE) -> str:
    collapsed = " ".join((value or "").split())
    return collapsed[:limit]


def main(path: str) -> int:
    try:
        root = ET.parse(path).getroot()
    except Exception:  # noqa: BLE001 - the report is best effort
        root = None

    reported = 0
    if root is not None:
        for case in root.iter("testcase"):
            for bad in list(case.findall("failure")) + list(case.findall("error")):
                name = f"{case.get('classname', '')}::{case.get('name', '')}"
                message = _one_line(bad.get("message") or bad.text or "")
                print(f"::error title=python-suite::{name} — {message}")
                reported += 1
                if reported >= MAX_REPORTED:
                    return 0

    if reported == 0:
        try:
            with open(LOG_PATH, encoding="utf-8", errors="replace") as handle:
                tail = handle.read().splitlines()[-15:]
        except OSError:
            tail = ["pytest failed and produced no readable log"]
        print(f"::error title=python-suite::{_one_line(' '.join(tail), 1200)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1] if len(sys.argv) > 1 else "/tmp/junit.xml"))
