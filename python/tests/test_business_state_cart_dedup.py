"""Business-state cart aggregates must use unique, unrecovered cart identities."""
from pathlib import Path

BUILDER = Path(__file__).resolve().parents[1] / "src" / "intelligence" / "business_state.py"


def test_cart_aggregation_and_opportunities_are_deduplicated():
    source = BUILDER.read_text()
    cart_section = source.split("# ── 3. Cart abandonment metrics", 1)[1].split("# ── 4.", 1)[0]
    opportunity_section = source.split("# ── 5. Build opportunities list", 1)[1]
    for section in (cart_section, opportunity_section):
        assert "ROW_NUMBER() OVER" in section
        assert "PARTITION BY store_id" in section
        assert "external_cart_id" in section
        assert "recovered_at IS NULL" in section
        assert "rn = 1" in section


def test_cart_aggregate_remains_48_hour_window():
    source = BUILDER.read_text()
    cart_section = source.split("# ── 3. Cart abandonment metrics", 1)[1]
    assert "abandoned_at >= NOW() - INTERVAL '48 hours'" in cart_section
