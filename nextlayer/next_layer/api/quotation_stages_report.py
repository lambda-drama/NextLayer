# Copyright (c) 2025, NextLayer and contributors
# For license information, please see license.txt

"""
Quotation Stages Report API.

Compares quotations across revision stages: Initial Quote, After Site Visit, Final Quote.
Groups by deal (custom_parent_quotation or root quotation) and returns amounts per stage
with optional currency conversion.
"""

from __future__ import unicode_literals
import json
import frappe
from frappe import _
from frappe.utils import flt

from nextlayer.next_layer.api.currency_converter import convert as convert_currency

REVISION_TYPES = ["Initial Quote", "After Site Visit", "Final Quote"]


def _get_company_currency(company: str) -> str:
	if not company:
		return "USD"
	return frappe.get_cached_value("Company", company, "default_currency") or "USD"


def _convert(amount: float, from_currency: str, to_currency: str, on_date: str) -> float:
	amount = flt(amount or 0)
	if not amount or not from_currency or not to_currency or from_currency == to_currency:
		return amount
	try:
		return flt(convert_currency(amount, to_currency, from_currency, on_date), 2)
	except Exception:
		return amount


def _quotation_has_project() -> bool:
	meta = frappe.get_meta("Quotation")
	return meta.get_field("project") is not None


def _parse_and_validate_filters(filters):
    """Parse raw filters input and validate required fields. Returns (filters_dict, error_string)."""
    filters = filters or frappe.form_dict or {}
    if isinstance(filters, str):
        
        try:
            filters = json.loads(filters)
        except Exception:
            filters = {}

    company = (filters.get("company") or "").strip()
    from_date = (filters.get("from_date") or "").strip()
    to_date = (filters.get("to_date") or "").strip()

    if not company:
        return None, _("Company is required")
    if not from_date or not to_date:
        return None, _("From Date and To Date are required")

    return {
        "company": company,
        "from_date": from_date,
        "to_date": to_date,
        "project": (filters.get("project") or "").strip() or None,
        "display_currency": (filters.get("currency") or "").strip(),
    }, None


def _fetch_and_group_deals(f, to_currency):
    """Fetch submitted quotations and group them into deals by revision chain."""
    company = f["company"]
    company_currency = _get_company_currency(company)

    qty_filters = [
        ["Quotation", "company", "=", company],
        ["Quotation", "transaction_date", ">=", f["from_date"]],
        ["Quotation", "transaction_date", "<=", f["to_date"]],
        ["Quotation", "custom_revision_type", "in", REVISION_TYPES],
        ["Quotation", "docstatus", "=", 1],
    ]
    if f["project"] and _quotation_has_project():
        qty_filters.append(["Quotation", "project", "=", f["project"]])

    fields = [
        "name", "party_name", "transaction_date", "grand_total", "currency",
        "custom_revision_type", "custom_parent_quotation",
    ]
    if _quotation_has_project():
        fields.append("project")

    quotations = frappe.get_all(
        "Quotation", fields=fields, filters=qty_filters, order_by="transaction_date asc"
    )

    stage_key_map = {
        "Initial Quote": "initial_quote",
        "After Site Visit": "after_site_visit",
        "Final Quote": "final_quote",
    }

    deal_map = {}
    for q in quotations:
        rev = (q.get("custom_revision_type") or "").strip()
        if rev not in REVISION_TYPES:
            continue
        parent = (q.get("custom_parent_quotation") or "").strip()
        group_key = parent or q.get("name") or ""
        if not group_key:
            continue

        deal_map.setdefault(group_key, {
            "group_key": group_key,
            "party_name": q.get("party_name"),
            "project": q.get("project") if _quotation_has_project() else None,
            "initial_quote": None,
            "after_site_visit": None,
            "final_quote": None,
        })
        deal_map[group_key][stage_key_map[rev]] = {
            "name": q.get("name"),
            "transaction_date": q.get("transaction_date"),
            "grand_total": flt(q.get("grand_total")),
            "currency": q.get("currency") or company_currency,
        }

    return deal_map, company_currency


def _build_report_output(deal_map, f, company_currency, to_currency):
    """Convert deal map into report entries, totals, and meta."""
    totals_initial = totals_after_site = totals_final = 0.0
    entries = []

    def stage_amount(stage):
        if not stage:
            return 0.0
        dt = str(stage.get("transaction_date") or "")
        amt = flt(stage.get("grand_total"))
        curr = stage.get("currency") or company_currency
        return _convert(amt, curr, to_currency, dt or f["from_date"]) if amt else 0.0

    for group_key, deal in deal_map.items():
        initial_c = stage_amount(deal.get("initial_quote"))
        after_c = stage_amount(deal.get("after_site_visit"))
        final_c = stage_amount(deal.get("final_quote"))

        totals_initial += initial_c
        totals_after_site += after_c
        totals_final += final_c

        def stage_field(stage, field):
            return stage.get(field) if stage else None

        for prefix, stage in [("initial_quote", deal.get("initial_quote")),
                               ("after_site_visit", deal.get("after_site_visit")),
                               ("final_quote", deal.get("final_quote"))]:
            _ = None  # placeholder, fields built below

        entries.append({
            "group_key": group_key,
            "party_name": deal.get("party_name") or "",
            "project": deal.get("project") or "",
            "initial_quote_name": stage_field(deal.get("initial_quote"), "name"),
            "initial_quote_date": stage_field(deal.get("initial_quote"), "transaction_date"),
            "initial_quote_amount": initial_c,
            "after_site_visit_name": stage_field(deal.get("after_site_visit"), "name"),
            "after_site_visit_date": stage_field(deal.get("after_site_visit"), "transaction_date"),
            "after_site_visit_amount": after_c,
            "final_quote_name": stage_field(deal.get("final_quote"), "name"),
            "final_quote_date": stage_field(deal.get("final_quote"), "transaction_date"),
            "final_quote_amount": final_c,
            "variance_initial_to_final": final_c - initial_c,
            "variance_after_site_to_final": final_c - after_c,
            "currency": to_currency,
        })

    return {
        "success": True,
        "entries": entries,
        "totals": {
            "total_initial": totals_initial,
            "total_after_site_visit": totals_after_site,
            "total_final": totals_final,
            "variance_initial_to_final": totals_final - totals_initial,
            "variance_after_site_to_final": totals_final - totals_after_site,
            "deal_count": len(entries),
        },
        "meta": {
            "company": f["company"],
            "from_date": f["from_date"],
            "to_date": f["to_date"],
            "display_currency": to_currency,
            "company_currency": company_currency,
        },
    }


@frappe.whitelist()
def get_quotation_stages_report(filters=None):
    f, error = _parse_and_validate_filters(filters)
    if error:
        return {"success": False, "error": error}

    company_currency = _get_company_currency(f["company"])
    to_currency = f["display_currency"] or company_currency

    deal_map, company_currency = _fetch_and_group_deals(f, to_currency)
    return _build_report_output(deal_map, f, company_currency, to_currency)