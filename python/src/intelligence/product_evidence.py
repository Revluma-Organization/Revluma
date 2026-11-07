"""Canonical tenant-scoped Shopify product, variant and inventory evidence."""
from __future__ import annotations

from datetime import datetime
from typing import Any

from decimal import Decimal

from .evidence import EVIDENCE_SCHEMA_VERSION, STATUS_AVAILABLE, STATUS_PARTIAL, STATUS_UNAVAILABLE, STATUS_UNSUPPORTED, _evidence_id, availability_of, decimal_value, ensure_utc, evidence_item, iso, period, previous_period, utc_now
from .query import safe_query

_PRODUCT_SQL = """
SELECT p.id, p.store_id, p.external_id, p.name, p.type, p.status, p.vendor,
 p.sku, p.created_at, p.updated_at, p.created_at_auto, p.updated_at_auto,
 p.manage_stock, p.stock_quantity, p.stock_status
FROM products p JOIN stores s ON s.id = p.store_id
WHERE s.organization_id = CAST(:org_id AS uuid) AND s.status IN ('active','connected','syncing')
"""
_VARIANT_SQL = """
SELECT v.store_id, v.product_external_id, v.external_id, v.title, v.sku, v.barcode,
 v.inventory_item_external_id, v.price, v.compare_at_price, v.selected_options,
 v.position, v.tracked, v.available_for_sale, v.created_at, v.updated_at, v.synced_at
FROM product_variants v JOIN stores s ON s.id = v.store_id
WHERE s.organization_id = CAST(:org_id AS uuid) AND s.status IN ('active','connected','syncing')
 AND v.product_external_id = ANY(:product_ids)
ORDER BY v.product_external_id, v.position, v.external_id LIMIT 1000
"""
_INVENTORY_SQL = """
SELECT v.store_id, v.product_external_id, v.external_id AS variant_id, i.external_id AS inventory_item_id,
 i.sku AS inventory_sku, i.tracked AS inventory_tracked, l.external_id AS location_id,
 l.name AS location_name, l.is_active, il.quantities, il.synced_at
FROM product_variants v
JOIN inventory_items i ON i.store_id=v.store_id AND i.external_id=v.inventory_item_external_id
LEFT JOIN inventory_levels il ON il.store_id=i.store_id AND il.inventory_item_external_id=i.external_id
LEFT JOIN locations l ON l.store_id=il.store_id AND l.external_id=il.location_external_id
JOIN stores s ON s.id=v.store_id
WHERE s.organization_id=CAST(:org_id AS uuid) AND s.status IN ('active','connected','syncing')
 AND v.product_external_id=ANY(CAST(:product_ids AS text[]))
ORDER BY v.product_external_id,v.external_id,l.external_id LIMIT 2000
"""
_LEDGER_SQL = """
SELECT d.store_id,d.domain,d.status,d.pagination_complete,d.last_succeeded_at,d.error_code
FROM store_sync_domain_states d JOIN stores s ON s.id=d.store_id
WHERE s.organization_id=CAST(:org_id AS uuid) AND s.status IN ('active','connected','syncing')
 AND d.domain IN ('products','inventory_items','inventory_levels','locations')
"""
_PERFORMANCE_SQL = """
SELECT oi.store_id, oi.external_product_id, oi.external_variant_id, o.currency,
 SUM(oi.quantity) AS units, SUM(oi.line_total) AS line_value,
 COUNT(DISTINCT o.id) AS order_count
FROM order_items oi JOIN orders o ON o.id=oi.order_id AND o.store_id=oi.store_id
JOIN stores s ON s.id=oi.store_id
WHERE s.organization_id=CAST(:org_id AS uuid) AND s.status IN ('active','connected','syncing')
 AND oi.external_product_id=ANY(CAST(:product_ids AS text[]))
 AND oi.ordered_at>=:start AND oi.ordered_at<:end
 AND (o.recovery_status IS NULL OR o.recovery_status NOT IN ('cancelled','canceled','voided','deleted'))
GROUP BY oi.store_id,oi.external_product_id,oi.external_variant_id,o.currency
ORDER BY oi.store_id,oi.external_product_id,oi.external_variant_id,o.currency LIMIT 1000
"""
_LINE_SQL = """
SELECT oi.product_name,o.currency,SUM(oi.quantity) AS units,SUM(oi.line_total) AS line_value
FROM order_items oi JOIN orders o ON o.id=oi.order_id AND o.store_id=oi.store_id
JOIN stores s ON s.id=oi.store_id
WHERE s.organization_id=CAST(:org_id AS uuid) AND s.status IN ('active','connected','syncing')
 AND oi.ordered_at>=:start AND oi.ordered_at<:end
 AND (o.recovery_status IS NULL OR o.recovery_status NOT IN ('cancelled','canceled','voided','deleted'))
GROUP BY oi.product_name,o.currency ORDER BY line_value DESC NULLS LAST,oi.product_name LIMIT 6
"""
# Bounded superset used only for comparison-window change computation (Task
# 206): top 100 recorded line names per window. Historical line titles are
# not current product identity — the comparison carries that caveat.
_LINE_COMPARE_SQL = """
SELECT oi.product_name,o.currency,SUM(oi.quantity) AS units,SUM(oi.line_total) AS line_value
FROM order_items oi JOIN orders o ON o.id=oi.order_id AND o.store_id=oi.store_id
JOIN stores s ON s.id=oi.store_id
WHERE s.organization_id=CAST(:org_id AS uuid) AND s.status IN ('active','connected','syncing')
 AND oi.ordered_at>=:start AND oi.ordered_at<:end
 AND (o.recovery_status IS NULL OR o.recovery_status NOT IN ('cancelled','canceled','voided','deleted'))
GROUP BY oi.product_name,o.currency ORDER BY line_value DESC NULLS LAST,oi.product_name LIMIT 100
"""
_FINDING_SQL = """
SELECT f.id,f.store_id,f.type,f.severity,f.status,f.title,f.detected_at,f.updated_at,
 p.external_id AS product_id,p.store_id AS product_store_id
FROM intelligence_findings f JOIN products p ON p.store_id=f.store_id
JOIN stores s ON s.id=f.store_id
WHERE s.organization_id=CAST(:org_id AS uuid) AND f.organization_id=CAST(:org_id AS uuid)
 AND s.status IN ('active','connected','syncing') AND p.external_id=ANY(CAST(:product_ids AS text[]))
 AND (f.evidence->>'productId'=p.external_id OR f.evidence->>'product_id'=p.external_id)
ORDER BY f.detected_at DESC LIMIT 100
"""


def _get(row,key,default=None):
    try: return row[key]
    except (KeyError,TypeError,IndexError): return getattr(row,key,default)


def _json(value,fallback):
    if isinstance(value,(dict,list)): return value
    if value is None: return fallback
    try:
        import json
        return json.loads(str(value))
    except (TypeError,ValueError): return fallback


def _line_items_for(rows, window):
    """product_units_sold + product_recorded_value items for recorded line rows.

    One code path for the main retrieval and the comparison windows. A
    recorded zero or missing line value is NOT asserted as a monetary item
    (monetary zero requires certified coverage); it is carried as an
    explicit unsupported item so the gap is visible, and the raw value
    remains available to comparison calculations with their own guards.
    """
    built=[]
    for line in rows:
        name=str(_get(line,"product_name") or "Unnamed product")[:200]
        currency=_get(line,"currency")
        units=_get(line,"units")
        if isinstance(units,int):
            built.append(evidence_item("product_units_sold",label=f"Units sold: {name} ({currency})",value=units,window=window,source="order_items",discriminator=f"{name}:{currency}",definition="Units recorded on non-cancelled order lines; stored product identity may be unavailable.",domain="products",limitations=["Historical order-line title is not a current product identity."]))
        raw_value=_get(line,"line_value")
        numeric=decimal_value(raw_value)
        if numeric is None:
            built.append(evidence_item("product_recorded_value",label=f"Recorded value: {name} ({currency})",value=None,status=STATUS_UNSUPPORTED,unit="currency",currency=currency,window=window,source="order_items",discriminator=f"{name}:{currency}",definition="Recorded historical line-item value, not profit or proof of a revenue-change cause.",domain="products",limitations=["Recorded line value is missing; zero is not asserted."]))
        elif numeric==0:
            built.append(evidence_item("product_recorded_value",label=f"Recorded value: {name} ({currency})",value=None,status=STATUS_UNSUPPORTED,unit="currency",currency=currency,window=window,source="order_items",discriminator=f"{name}:{currency}",definition="Recorded historical line-item value, not profit or proof of a revenue-change cause.",domain="products",limitations=["Recorded line value is zero; zero is not asserted without certified coverage."]))
        else:
            built.append(evidence_item("product_recorded_value",label=f"Recorded value: {name} ({currency})",value=raw_value,unit="currency",currency=currency,window=window,source="order_items",discriminator=f"{name}:{currency}",definition="Recorded historical line-item value, not profit or proof of a revenue-change cause.",domain="products",limitations=["Line-item value excludes later refunds unless separately evidenced."]))
    return built


def _product_comparison(organization_id, db, *, start, end, window, timezone_name,
                        items, comparison_start=None, comparison_end=None):
    """Bounded per-line-name change between the current window and the
    previous window (Task 206).

    Fail-closed rules:
    - a line name with no recorded rows in a window is NOT treated as a
      verified zero: the entry is marked unrecorded and the change is
      unsupported (absence of rows cannot be distinguished from an incomplete
      sync at the line-title level);
    - percent requires a positive previous value (zero denominators are
      unsupported, matching the revenue comparison contract);
    - every change carries both sides' evidence ids, and both sides' items
      are present in the result so every cited number is resolvable.

    ``items`` (the live main items list) is extended with current-window line
    items for changed names not already displayed, so current-side ids always
    resolve inside the result.
    """
    if comparison_start is not None and comparison_end is not None:
        cs,ce=ensure_utc(comparison_start),ensure_utc(comparison_end)
        if ce<=cs: raise ValueError("comparison end must be after comparison start")
        if cs>=start: raise ValueError("comparison period must end before the current period starts")
    else:
        cs,ce=previous_period(start,end)
    prev_window=period(cs,ce,timezone_label=timezone_name,label="previous period")
    prev_rows,prev_error=safe_query(db,_LINE_COMPARE_SQL,{"org_id":organization_id,"start":cs,"end":ce})
    curr_rows,curr_error=safe_query(db,_LINE_COMPARE_SQL,{"org_id":organization_id,"start":start,"end":end})
    if curr_error:
        return {"period":prev_window,"overall_status":STATUS_UNAVAILABLE,
                "reason":"current_window_line_query_failed","items":[],"changes":[]}
    prev_items=_line_items_for(prev_rows,prev_window)
    prev_status=availability_of(prev_items) if prev_items else (STATUS_UNAVAILABLE if prev_error else STATUS_AVAILABLE)
    if prev_error:
        prev_status=STATUS_UNAVAILABLE

    def _index(rows):
        index={}
        for line in rows:
            name=str(_get(line,"product_name") or "Unnamed product")[:200]
            currency=_get(line,"currency")
            index[f"{name}:{currency}"]={"product_name":name,"currency":currency,
                "units":_get(line,"units"),"value":decimal_value(_get(line,"line_value"))}
        return index
    curr_index=_index(curr_rows)
    prev_index=_index(prev_rows)
    ordered=list(dict.fromkeys(list(curr_index)+list(prev_index)))
    changes=[]
    for key in ordered:
        c=curr_index.get(key);p=prev_index.get(key)
        currency=(c or p)["currency"];name=(c or p)["product_name"]
        current_value=c["value"] if c else None
        previous_value=p["value"] if p else None
        current_id=_evidence_id("product_recorded_value",currency,window,"order_items",key) if c else None
        previous_id=_evidence_id("product_recorded_value",currency,prev_window,"order_items",key) if p else None
        delta=None
        if current_value is not None and previous_value is not None:
            delta=current_value-previous_value
        percent=None;direction=None
        if delta is not None:
            direction="up" if delta>0 else "down" if delta<0 else "flat"
            if previous_value>0:
                percent=str(((delta/previous_value)*Decimal(100)).quantize(Decimal("0.1")))
        if current_value is None and previous_value is None:
            status=STATUS_UNSUPPORTED;reason="no_recorded_line_rows_in_either_window"
        elif current_value is None:
            status=STATUS_UNSUPPORTED;reason="no_recorded_line_rows_in_current_window"
        elif previous_value is None:
            status=STATUS_UNSUPPORTED;reason="no_recorded_line_rows_in_previous_window"
        elif delta is None or previous_value<0:
            status=STATUS_UNSUPPORTED;reason="value_unavailable"
        else:
            # Both sides recorded: the delta is a verified computation. The
            # percent is None (not invented) when the previous value is zero —
            # a zero denominator is disclosed, not divided.
            status=STATUS_AVAILABLE;reason=None
        changes.append({"metric":"product_recorded_value_change","product_name":name,
            "currency":currency,"current":str(current_value) if current_value is not None else None,
            "previous":str(previous_value) if previous_value is not None else None,
            "delta":str(delta) if delta is not None else None,
            "percent":percent,"direction":direction,
            "current_units":c["units"] if c else None,"previous_units":p["units"] if p else None,
            "status":status,"reason":reason,
            "definition":"Recorded non-cancelled line-item value for this line name and currency; historical line titles are not current product identity.",
            "current_evidence_id":current_id,"previous_evidence_id":previous_id})
    def _sort_key(change):
        if change["delta"] is None:
            fallback=max(Decimal(change["current"] or 0),Decimal(change["previous"] or 0))
            return (1,fallback,change["product_name"],str(change["currency"]))
        return (0,-abs(Decimal(change["delta"])),change["product_name"],str(change["currency"]))
    changes.sort(key=_sort_key)
    bounded_changes=changes[:10]
    present_ids={item.get("id") for item in items}
    for change in bounded_changes:
        current_id=change.get("current_evidence_id")
        if current_id and current_id not in present_ids:
            key=f"{change['product_name']}:{change['currency']}"
            row=next((r for r in curr_rows if f"{str(_get(r,'product_name') or 'Unnamed product')[:200]}:{_get(r,'currency')}"==key),None)
            if row is not None:
                for extra in _line_items_for([row],window):
                    if extra.get("id") not in present_ids:
                        items.append(extra)
                        present_ids.add(extra.get("id"))
    return {"period":prev_window,"overall_status":prev_status,
        "items":prev_items,"changes":bounded_changes,
        "scope":"top 100 recorded line names per window (line titles are not current product identity)",
        "currency_note":"Changes are per currency; no cross-currency totals are computed."}


def retrieve_product_evidence(organization_id: str, db, *, start: datetime, end: datetime,
                              now: datetime | None=None, timezone_name: str="UTC",
                              product_reference: str | None=None, latest: bool=False,
                              compare: bool=False, comparison_start=None, comparison_end=None,
                              label: str | None=None) -> dict:
    if not organization_id: raise ValueError("authenticated organization required")
    start,end=ensure_utc(start),ensure_utc(end)
    if end<=start: raise ValueError("end must be after start")
    now=ensure_utc(now or utc_now(),field="now")
    if compare and product_reference:
        # A single-product retrieval cannot answer a contribution question;
        # the comparison is defined over the store's recorded line names.
        compare=False
    params={"org_id":organization_id}
    sql=_PRODUCT_SQL
    if product_reference:
        reference=str(product_reference).strip()
        if not reference or len(reference)>160: raise ValueError("invalid product reference")
        sql += " AND (p.id::text=:reference OR p.external_id=:reference OR lower(p.name)=lower(:reference) OR p.sku=:reference)"
        params["reference"]=reference
    sql += " ORDER BY COALESCE(p.updated_at,p.updated_at_auto,p.created_at_auto) DESC NULLS LAST,p.id DESC LIMIT 26"
    rows,error=safe_query(db,sql,params)
    if error:
        return {"schema_version":EVIDENCE_SCHEMA_VERSION,"items":[],"warnings":["product_query_failed"],"limitations":["Product evidence is unavailable."],"overall_status":STATUS_UNAVAILABLE,"generated_at":iso(now)}
    if latest: rows=rows[:1]
    if product_reference and len(rows)>1 and not str(product_reference).isdigit():
        return {"schema_version":EVIDENCE_SCHEMA_VERSION,"items":[],"warnings":["ambiguous_product_reference"],"limitations":["Use a stable Shopify product ID, variant SKU or internal UUID."],"overall_status":STATUS_PARTIAL,"generated_at":iso(now)}
    truncated=len(rows)>25
    rows=rows[:25]
    if not rows:
        return {"schema_version":EVIDENCE_SCHEMA_VERSION,"items":[],"warnings":["product_not_found_in_authorized_scope"],"limitations":["Missing stored evidence does not prove the product does not exist or is unavailable."],"overall_status":STATUS_PARTIAL,"generated_at":iso(now)}
    external_ids=[str(_get(row,"external_id")) for row in rows]
    query_params={"org_id":organization_id,"product_ids":external_ids,"start":start,"end":end}
    variants,variant_error=safe_query(db,_VARIANT_SQL,query_params)
    inventory,inventory_error=safe_query(db,_INVENTORY_SQL,query_params)
    ledgers,ledger_error=safe_query(db,_LEDGER_SQL,{"org_id":organization_id})
    performance,performance_error=safe_query(db,_PERFORMANCE_SQL,query_params)
    findings,finding_error=safe_query(db,_FINDING_SQL,query_params)
    line_rows,line_error=safe_query(db,_LINE_SQL,query_params)
    warnings=[]
    if truncated: warnings.append("product_result_truncated")
    for failed,warning in ((variant_error,"product_variants_incomplete"),(inventory_error,"product_inventory_incomplete"),(ledger_error,"product_sync_coverage_unavailable"),(performance_error,"product_order_lines_incomplete"),(finding_error,"product_findings_incomplete"),(line_error,"product_order_line_summary_incomplete")):
        if failed: warnings.append(warning)
    ledger_by_store={}
    for ledger in ledgers: ledger_by_store.setdefault(str(_get(ledger,"store_id")),[]).append(ledger)
    window=period(start,end,timezone_label=timezone_name,label=label)
    items=[]
    for row in rows:
        product_id=str(_get(row,"external_id"))
        store_id=str(_get(row,"store_id"))
        store_ledgers=ledger_by_store.get(store_id,[])
        product_ledger=next((l for l in store_ledgers if _get(l,"domain")=="products"),None)
        inventory_ledgers=[l for l in store_ledgers if _get(l,"domain") in {"inventory_items","inventory_levels","locations"}]
        complete=bool(product_ledger and _get(product_ledger,"status")=="ok" and _get(product_ledger,"pagination_complete") is True and not ledger_error)
        inventory_complete=bool(inventory_ledgers and all(_get(l,"status")=="ok" and _get(l,"pagination_complete") is True for l in inventory_ledgers))
        synced=_get(product_ledger,"last_succeeded_at") if product_ledger else None
        age=max(0,int((now-ensure_utc(synced)).total_seconds())) if isinstance(synced,datetime) else None
        freshness={"state":"fresh" if age is not None and age<=3600 else "aging" if age is not None and age<=7200 else "stale" if age is not None else "unknown","as_of":iso(synced),"age_seconds":age,"policy":"3600s"}
        product_variants=[]
        for variant in variants:
            if str(_get(variant,"product_external_id"))!=product_id or str(_get(variant,"store_id"))!=store_id: continue
            levels=[]
            for level in inventory:
                if str(_get(level,"store_id"))==store_id and str(_get(level,"product_external_id"))==product_id and str(_get(level,"variant_id"))==str(_get(variant,"external_id")):
                    levels.append({"inventory_item_id":_get(level,"inventory_item_id"),"location_id":_get(level,"location_id"),"location_name":_get(level,"location_name"),"location_active":_get(level,"is_active"),"quantities":_json(_get(level,"quantities"),{}),"synced_at":iso(_get(level,"synced_at"))})
            product_variants.append({"variant_id":_get(variant,"external_id"),"title":_get(variant,"title"),"sku":_get(variant,"sku"),"barcode":_get(variant,"barcode"),"inventory_item_id":_get(variant,"inventory_item_external_id"),"price":str(_get(variant,"price")) if _get(variant,"price") is not None else None,"compare_at_price":str(_get(variant,"compare_at_price")) if _get(variant,"compare_at_price") is not None else None,"selected_options":_json(_get(variant,"selected_options"),[]),"position":_get(variant,"position"),"tracked":_get(variant,"tracked"),"available_for_sale":_get(variant,"available_for_sale"),"updated_at":iso(_get(variant,"updated_at")),"synced_at":iso(_get(variant,"synced_at")),"inventory_levels":levels,"inventory_status":"not_ingested" if not levels else "observed"})
        product_performance=[]
        for metric in performance:
            if str(_get(metric,"external_product_id"))==product_id and str(_get(metric,"store_id"))==store_id:
                product_performance.append({"variant_id":_get(metric,"external_variant_id"),"currency":_get(metric,"currency"),"units":_get(metric,"units"),"recorded_line_value":str(_get(metric,"line_value")) if _get(metric,"line_value") is not None else None,"order_count":_get(metric,"order_count"),"period":window,"definition":"Historical non-cancelled order lines; not demand, conversion, profit or proof of a revenue-change cause."})
        product_findings=[{"finding_id":str(_get(f,"id")),"type":_get(f,"type"),"severity":_get(f,"severity"),"lifecycle_status":_get(f,"status"),"title":_get(f,"title"),"detected_at":iso(_get(f,"detected_at")),"updated_at":iso(_get(f,"updated_at"))} for f in findings if str(_get(f,"product_id"))==product_id and str(_get(f,"product_store_id"))==store_id]
        value={"product_id":product_id,"internal_id":str(_get(row,"id")),"store_id":store_id,"title":_get(row,"name"),"product_type":_get(row,"type"),"vendor":_get(row,"vendor"),"catalog_status":_get(row,"status"),"product_sku":_get(row,"sku"),"created_at":iso(_get(row,"created_at") or _get(row,"created_at_auto")),"updated_at":iso(_get(row,"updated_at") or _get(row,"updated_at_auto")),"variants":product_variants,"order_line_evidence":product_performance,"finding_references":product_findings,"legacy_stock_fields":{"manage_stock":_get(row,"manage_stock"),"stock_quantity":_get(row,"stock_quantity"),"stock_status":_get(row,"stock_status"),"warning":"Legacy stock fields do not replace variant/location inventory evidence."},"inventory_coverage_complete":inventory_complete}
        items.append(evidence_item("product_evidence",label=_get(row,"name") or f"Shopify product {product_id}",value=value,unit="record",window=window,source="products",status="available" if complete else STATUS_PARTIAL,definition="Authorized Shopify product, distinct variants, location inventory where ingested, historical order lines and explicit product finding references.",coverage={"complete":complete,"status":"complete" if complete else "partial","resource":"products","inventory_complete":inventory_complete},freshness=freshness,limitations=["Missing inventory records never establish out-of-stock or unavailability.","Catalog status is not stock status.","Order-line associations do not establish causation."],domain="products",discriminator=f"{store_id}:{product_id}",classification="verified_fact",source_references=[{"source_id":product_id,"resource":"Shopify Product","sync_run_id":None}],provenance={"retrieval":"direct","transformation":"Organization/store joins across exact product, variant, inventory, order-line and finding identifiers.","calculation_version":"product-evidence-v1","lineage":[f"product:{store_id}:{product_id}"],"reproducible":True}))
    items.extend(_line_items_for(line_rows[:5],window))
    result={"schema_version":EVIDENCE_SCHEMA_VERSION,"items":items,"warnings":warnings,"limitations":["Product evidence is limited to authorized ingested records and disclosed synchronization coverage."],"overall_status":availability_of(items),"generated_at":iso(now)}
    if compare:
        result["comparison"]=_product_comparison(organization_id,db,start=start,end=end,window=window,timezone_name=timezone_name,items=items,comparison_start=comparison_start,comparison_end=comparison_end)
    return result
