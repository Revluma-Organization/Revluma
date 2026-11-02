from src.agents.investigation import INTENT_REVENUE, load_conversation_context
from tests.rev_fakes import FakeDB

ORG = "11111111-1111-1111-1111-111111111111"
USER = "22222222-2222-2222-2222-222222222222"
CONV = "33333333-3333-3333-3333-333333333333"


def test_node_context_payload_is_used_and_recent_turns_are_loaded():
    db = FakeDB()
    db.add("SELECT summary, context_window", [{
        "summary": "Old summary",
        "context_window": {"last_investigation": {"intent": "store_overview"}, "unresolved": []},
    }])
    db.add("FROM conversation_messages", [
        {"role": "user", "content": {"text": "Why did revenue fall?"}},
        {"role": "rev", "content": {"text": "I verified an order-value change."}},
    ])
    supplied = {
        "conversation_context": {
            "summary": "Revenue investigation for the previous seven days",
            "context_window": {
                "last_investigation": {"intent": INTENT_REVENUE, "status": "complete"},
                "unresolved": ["Device-level attribution is unavailable."],
            },
        },
    }

    context = load_conversation_context(ORG, USER, CONV, db, context_payload=supplied)

    assert context["summary"] == "Revenue investigation for the previous seven days"
    assert context["last_investigation"]["intent"] == INTENT_REVENUE
    assert context["unresolved"] == ["Device-level attribution is unavailable."]
    assert [turn["role"] for turn in context["recent_turns"]] == ["user", "rev"]
