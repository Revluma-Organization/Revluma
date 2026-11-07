"""Task 210: dump REAL run_investigation payloads for the Node boundary.

Run:  python scripts/dump_task210_payloads.py
Writes /tmp/task210_payloads.json — real pipeline outputs (the exact dict the
API returns to Node), using the same deterministic-routable messages and
harnesses as tests/test_rev_adaptive_response.py, so the Node fail-closed
validator is proven against production-shaped data.
"""
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
os.environ["REV_NARRATIVE_LLM"] = "false"
os.environ.pop("GEMINI_API_KEY", None)
os.environ.pop("ANTHROPIC_API_KEY", None)

from src.agents.investigation import run_investigation  # noqa: E402
from tests.test_rev_investigation import (  # noqa: E402
    CONV, NOW, ORG, USER,
    REVENUE_AGGREGATE_PATTERN, workspace_db,
)
from tests.test_rev_investigation_scenarios import (  # noqa: E402
    comparison_revenue_db,
)
from tests.test_rev_adaptive_response import (  # noqa: E402
    context_payload_for,
)


payloads = []

# 1. Direct factual question, healthy store.
r1 = run_investigation(
    ORG, USER, "How many orders did I get yesterday?",
    db=workspace_db(), now=NOW, persist=False)
payloads.append({"name": "direct_healthy", "payload": r1})

# 2. Comparative question with a previous window.
r2 = run_investigation(
    ORG, USER, "Why did my revenue drop this month?",
    db=comparison_revenue_db(), now=NOW, persist=False)
payloads.append({"name": "comparative", "payload": r2})

# 3. Multi-domain overview.
r3 = run_investigation(
    ORG, USER, "How is my store doing?",
    db=workspace_db(), now=NOW, persist=False)
payloads.append({"name": "overview", "payload": r3})

# 4. Turn one + meta follow-up (verification) from the recorded claims.
first = run_investigation(
    ORG, USER, "Why did my revenue drop this month?",
    db=comparison_revenue_db(), now=NOW, persist=True,
    conversation_id=CONV)
payloads.append({"name": "turn_one_persisted", "payload": first})
r4 = run_investigation(
    ORG, USER, "Are you sure?",
    db=workspace_db(), now=NOW, persist=True,
    conversation_id=CONV,
    context_payload=context_payload_for(first))
payloads.append({"name": "meta_verification", "payload": r4})

# 5. Explicit challenge -> correction flow (retraction, not verification).
r5 = run_investigation(
    ORG, USER, "Are you sure? That's wrong.",
    db=comparison_revenue_db(), now=NOW, persist=True,
    conversation_id=CONV,
    context_payload=context_payload_for(first))
payloads.append({"name": "correction", "payload": r5})

# 6. Degraded: order retrieval fails while the store itself is healthy.
r6 = run_investigation(
    ORG, USER, "Why did my revenue fall this week?",
    db=workspace_db(fail=(
        REVENUE_AGGREGATE_PATTERN, "COUNT(*) AS order_count",
        "COUNT(DISTINCT o.customer_id)", "WITH ranked", "FROM events",
        "FROM order_items oi", "completed_count")),
    now=NOW, persist=False)
payloads.append({"name": "degraded_partial", "payload": r6})

out = Path("/tmp/task210_payloads.json")
out.write_text(json.dumps(payloads, indent=2, default=str) + "\n")
print(f"wrote {out} with {len(payloads)} payloads")
for p in payloads:
    r = p["payload"]
    print(f"  {p['name']:22s} response_type={r.get('response_type')} "
          f"profile={(r.get('response_profile') or {}).get('response_intent')} "
          f"confidence={(r.get('response') or {}).get('confidence', {}).get('category')}")
