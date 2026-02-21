# Copyright (c) Next Layer. Import & Export Expense Report API.
"""
API for Import & Export Expense Report.

- Export: Sales Invoices with custom_is_export_sale = 1 only; costs from Sales Shipment Cost.
- Import: Purchase Invoices with custom_is_export_sale = 1 only; costs from Landed Cost Voucher.

Invoices are linked via custom_transit_number (Transit Numbers). Same journey = same items on
import and export. Rows are ITEM-BASED: one row per (journey, item) with that item's total
import (additional_costs) and total export (export_charges, plus journey-level freight/storage
on the first item row). All Excel columns: Description, Item, Transit/Journey, Date, Import
Container, Export Container, Export B/L, Freight, Storage, Additional Costs, Export Charges, Total.
"""

import frappe
from frappe import _
from frappe.utils import flt
from collections import defaultdict


def _get_custom_value(doc, fieldname, default=""):
    """Safe get for custom or standard fields."""
    if doc is None:
        return default
    val = doc.get(fieldname)
    return val if val is not None and val != "" else default


def _transit_table_exists():
    return frappe.db.table_exists("Transit Numbers")


def _get_neighbor_invoices(doctype, name):
    """Get set of (doctype, name) that are transit-linked from or to this invoice."""
    out = set()
    if not _transit_table_exists():
        return out
    # Rows where this invoice is the parent: linked invoices are (document_type, transit_no)
    rows = frappe.get_all(
        "Transit Numbers",
        filters={"parent": name, "parenttype": doctype},
        fields=["document_type", "transit_no"],
    )
    for r in rows:
        if r.get("transit_no") and r.get("document_type"):
            out.add((r["document_type"], r["transit_no"]))
    # Rows where this invoice is the transit_no: the parent is the other invoice
    rows2 = frappe.get_all(
        "Transit Numbers",
        filters={"transit_no": name, "document_type": doctype},
        fields=["parent", "parenttype"],
    )
    for r in rows2:
        if r.get("parent") and r.get("parenttype"):
            out.add((r["parenttype"], r["parent"]))
    return out


def _get_all_invoices_in_journey(doctype, name):
    """Return set of (doctype, name) that are in the same transit journey (connected component)."""
    visited = set()
    queue = [(doctype, name)]
    while queue:
        dt, n = queue.pop()
        key = (dt, n)
        if key in visited:
            continue
        visited.add(key)
        for neighbor in _get_neighbor_invoices(dt, n):
            if neighbor not in visited:
                queue.append(neighbor)
    return visited


def _build_journey_to_invoices(from_date, to_date, company_filter, currency_filter):
    """
    Get all PI (import) and SI (export) in date range with custom_is_export_sale=1,
    group them by journey (transit connected component). Returns:
      journey_id_to_pi: dict journey_id -> list of PI names
      journey_id_to_si: dict journey_id -> list of SI names
      journey_id_display: dict journey_id -> display string (e.g. first PI or SI name)
    """
    journey_id_to_pi = defaultdict(list)
    journey_id_to_si = defaultdict(list)
    journey_id_display = {}
    seen_components = {}  # (frozenset of (dt, name)) -> journey_id

    def _journey_id_for(doctype, name):
        comp = _get_all_invoices_in_journey(doctype, name)
        key = frozenset(comp)
        if key not in seen_components:
            # Use first (dt, name) sorted as canonical id for display
            first = sorted(key, key=lambda x: (x[0], x[1]))[0]
            jid = f"{first[0]}|{first[1]}"
            seen_components[key] = jid
            journey_id_display[jid] = first[1]  # show first invoice name
        return seen_components[key]

    # Purchase Invoices (import): custom_is_export_sale = 1
    pi_filters = [
        ["Purchase Invoice", "docstatus", "=", 1],
        ["Purchase Invoice", "posting_date", "between", [from_date, to_date]],
        ["Purchase Invoice", "custom_is_export_sale", "=", 1],
    ]
    if company_filter:
        pi_filters.append(["Purchase Invoice", "company", "=", company_filter])
    pi_list = frappe.get_all("Purchase Invoice", filters=pi_filters, fields=["name"])

    for r in pi_list:
        pi_name = r.get("name")
        if not pi_name:
            continue
        jid = _journey_id_for("Purchase Invoice", pi_name)
        journey_id_to_pi[jid].append(pi_name)

    # Sales Invoices (export): custom_is_export_sale = 1
    si_filters = [
        ["Sales Invoice", "docstatus", "=", 1],
        ["Sales Invoice", "posting_date", "between", [from_date, to_date]],
        ["Sales Invoice", "custom_is_export_sale", "=", 1],
    ]
    if company_filter:
        si_filters.append(["Sales Invoice", "company", "=", company_filter])
    si_list = frappe.get_all("Sales Invoice", filters=si_filters, fields=["name"])

    for r in si_list:
        si_name = r.get("name")
        if not si_name:
            continue
        jid = _journey_id_for("Sales Invoice", si_name)
        journey_id_to_si[jid].append(si_name)

    return journey_id_to_pi, journey_id_to_si, journey_id_display


@frappe.whitelist()
def get_import_export_expense_report(filters=None):
    """
    Get Import & Export expense report data, grouped by transit journey.

    - Only Purchase Invoices with custom_is_export_sale = 1 (import) and Sales Invoices
      with custom_is_export_sale = 1 (export).
    - Invoices linked via custom_transit_number (Transit Numbers) are grouped into one row per journey.
    """
    try:
        if filters is None:
            filters = frappe.form_dict
        if isinstance(filters, str):
            filters = frappe.parse_json(filters)
        filters = filters or {}

        from_date = filters.get("from_date")
        to_date = filters.get("to_date")
        if not from_date or not to_date:
            frappe.throw(_("From Date and To Date are required"))

        company_filter = filters.get("company")
        item_filter = filters.get("item")
        currency_filter = filters.get("currency") or ""

        journey_id_to_pi, journey_id_to_si, journey_id_display = _build_journey_to_invoices(
            from_date, to_date, company_filter, currency_filter
        )
        all_journey_ids = sorted(set(journey_id_to_pi.keys()) | set(journey_id_to_si.keys()))

        entries = []
        total_additional_costs = 0
        total_export_charges = 0
        total_freight = 0
        total_storage = 0
        grand_total = 0

        for journey_id in all_journey_ids:
            pi_names = list(set(journey_id_to_pi.get(journey_id, [])))
            si_names = list(set(journey_id_to_si.get(journey_id, [])))
            display_name = journey_id_display.get(journey_id, journey_id.replace("|", " "))

            # Per-item totals for this journey: item_code -> (additional_costs, export_charges)
            item_import = defaultdict(lambda: 0.0)   # item_code -> additional_costs
            item_export = defaultdict(lambda: 0.0)  # item_code -> export_charges
            item_names = {}  # item_code -> description/item_name
            freight = 0
            storage = 0
            import_container = ""
            export_container = ""
            export_bl = ""
            currency_used = "USD"
            posting_dates = []

            # ─── Import: Landed Cost Voucher linked to any PI in this journey ───
            if pi_names:
                lcv_filters = [
                    ["Landed Cost Voucher", "docstatus", "=", 1],
                    ["Landed Cost Voucher", "posting_date", "between", [from_date, to_date]],
                ]
                if company_filter:
                    lcv_filters.append(["Landed Cost Voucher", "company", "=", company_filter])
                lcv_list = frappe.get_all(
                    "Landed Cost Voucher",
                    filters=lcv_filters,
                    fields=["name", "company", "posting_date"],
                    order_by="posting_date asc",
                )
                pi_set = set(pi_names)
                for lcv_row in lcv_list:
                    lcv_name = lcv_row.get("name")
                    lcv_company = lcv_row.get("company") or ""
                    lcv_currency = frappe.get_cached_value("Company", lcv_company, "default_currency") or "USD"
                    if currency_filter and currency_filter != "all" and lcv_currency != currency_filter:
                        continue
                    try:
                        lcv_doc = frappe.get_doc("Landed Cost Voucher", lcv_name)
                    except Exception:
                        continue
                    first_pr = lcv_doc.get("purchase_receipts") or []
                    linked_pi = []
                    for pr in first_pr:
                        if pr.get("receipt_document_type") == "Purchase Invoice" and pr.get("receipt_document"):
                            linked_pi.append(pr.get("receipt_document"))
                    if not (linked_pi and set(linked_pi) & pi_set):
                        continue
                    if not import_container and first_pr:
                        rec_type = first_pr[0].get("receipt_document_type")
                        rec_name = first_pr[0].get("receipt_document")
                        if rec_name and rec_type:
                            try:
                                if rec_type == "Purchase Invoice":
                                    pi_doc = frappe.get_doc("Purchase Invoice", rec_name)
                                    import_container = _get_custom_value(pi_doc, "custom_container_no")
                                else:
                                    pr_doc = frappe.get_doc("Purchase Receipt", rec_name)
                                    import_container = _get_custom_value(pr_doc, "custom_container_no")
                            except Exception:
                                pass
                    currency_used = lcv_currency
                    posting_dates.append(str(lcv_row.get("posting_date") or ""))
                    for item_row in lcv_doc.get("items") or []:
                        ic = item_row.get("item_code") or ""
                        if item_filter and ic != item_filter:
                            continue
                        if ic:
                            item_import[ic] += flt(item_row.get("applicable_charges"), 2)
                            if ic not in item_names:
                                item_names[ic] = (item_row.get("description") or frappe.get_cached_value("Item", ic, "item_name") or ic)

            # ─── Export: Sales Shipment Cost linked to any SI in this journey ───
            if si_names and frappe.db.table_exists("Sales Shipment Cost"):
                ssc_filters = [
                    ["Sales Shipment Cost", "docstatus", "=", 1],
                    ["Sales Shipment Cost", "posting_date", "between", [from_date, to_date]],
                ]
                if company_filter:
                    ssc_filters.append(["Sales Shipment Cost", "company", "=", company_filter])
                ssc_list = frappe.get_all(
                    "Sales Shipment Cost",
                    filters=ssc_filters,
                    fields=["name", "company", "posting_date"],
                    order_by="posting_date asc",
                )
                si_set = set(si_names)
                for ssc_row in ssc_list:
                    try:
                        ssc_doc = frappe.get_doc("Sales Shipment Cost", ssc_row.get("name"))
                    except Exception:
                        continue
                    purchase_receipts = ssc_doc.get("purchase_receipts") or []
                    linked_si = [
                        pr.get("receipt_document")
                        for pr in purchase_receipts
                        if pr.get("receipt_document_type") == "Sales Invoice" and pr.get("receipt_document")
                    ]
                    if not (linked_si and set(linked_si) & si_set):
                        continue
                    ssc_currency = "USD"
                    if currency_filter and currency_filter != "all" and ssc_currency != currency_filter:
                        continue
                    if not export_container or not export_bl:
                        for si_name in linked_si:
                            if si_name not in si_set:
                                continue
                            try:
                                si = frappe.get_doc("Sales Invoice", si_name)
                                if not export_container:
                                    export_container = _get_custom_value(si, "custom_container_no")
                                if not export_bl:
                                    export_bl = _get_custom_value(si, "custom_bill_of_landing")
                                if export_container and export_bl:
                                    break
                            except Exception:
                                pass
                    posting_dates.append(str(ssc_doc.posting_date or ""))
                    freight_val = None
                    storage_val = None
                    for tax in ssc_doc.get("taxes") or []:
                        desc = (tax.get("description") or "").lower()
                        amt = flt(tax.get("amount"), 2)
                        if "freight" in desc:
                            freight_val = amt if freight_val is None else (freight_val + amt)
                        elif "storage" in desc:
                            storage_val = amt if storage_val is None else (storage_val + amt)
                    if freight_val is not None:
                        freight += freight_val
                    if storage_val is not None:
                        storage += storage_val
                    for item_row in ssc_doc.get("items") or []:
                        ic = item_row.get("item_code") or ""
                        if item_filter and ic != item_filter:
                            continue
                        if ic:
                            item_export[ic] += flt(item_row.get("applicable_charges"), 2)
                            if ic not in item_names:
                                item_names[ic] = (item_row.get("description") or frappe.get_cached_value("Item", ic, "item_name") or ic)

            # All items that appear in this journey (import and/or export)
            all_item_codes = sorted(set(item_import.keys()) | set(item_export.keys()))
            if not all_item_codes:
                # Journey with no item-level data: one row with journey-level freight/storage only
                if freight or storage:
                    total_row = freight + storage
                    total_freight += freight
                    total_storage += storage
                    grand_total += total_row
                    entries.append({
                        "journey_id": journey_id,
                        "transit_display": display_name,
                        "item_code": "",
                        "item_name": "",
                        "description": "",
                        "posting_date": ", ".join(filter(None, sorted(set(posting_dates))))[:100] if posting_dates else "",
                        "import_container": import_container or "—",
                        "export_container": export_container or "—",
                        "export_bl": export_bl or "—",
                        "freight": freight if freight else None,
                        "storage": storage if storage else None,
                        "additional_costs": None,
                        "export_charges": None,
                        "total": total_row,
                        "currency": currency_used,
                        "source": "both" if (pi_names and si_names) else ("import" if pi_names else "export"),
                    })
            else:
                for idx, item_code in enumerate(all_item_codes):
                    add_costs = flt(item_import.get(item_code, 0), 2)
                    exp_charges = flt(item_export.get(item_code, 0), 2)
                    # Put journey-level freight/storage on first item row only
                    freight_row = (freight if freight else None) if idx == 0 else None
                    storage_row = (storage if storage else None) if idx == 0 else None
                    total_row = add_costs + exp_charges + (freight if idx == 0 else 0) + (storage if idx == 0 else 0)
                    total_additional_costs += add_costs
                    total_export_charges += exp_charges
                    if idx == 0:
                        total_freight += freight
                        total_storage += storage
                    grand_total += total_row
                    desc = item_names.get(item_code) or frappe.get_cached_value("Item", item_code, "item_name") or item_code
                    entries.append({
                        "journey_id": journey_id,
                        "transit_display": display_name,
                        "item_code": item_code,
                        "item_name": item_code,
                        "description": desc,
                        "posting_date": ", ".join(filter(None, sorted(set(posting_dates))))[:100] if posting_dates else "",
                        "import_container": import_container or "—",
                        "export_container": export_container or "—",
                        "export_bl": export_bl or "—",
                        "freight": freight_row,
                        "storage": storage_row,
                        "additional_costs": add_costs if add_costs else None,
                        "export_charges": exp_charges if exp_charges else None,
                        "total": total_row,
                        "currency": currency_used,
                        "source": "both" if (pi_names and si_names) else ("import" if pi_names else "export"),
                    })

        totals = {
            "total_additional_costs": total_additional_costs,
            "total_export_charges": total_export_charges,
            "total_freight": total_freight,
            "total_storage": total_storage,
            "grand_total": grand_total,
        }

        return {
            "success": True,
            "entries": entries,
            "totals": totals,
            "filters_applied": {
                "from_date": from_date,
                "to_date": to_date,
                "company": company_filter,
                "item": item_filter,
                "currency": currency_filter or "all",
            },
        }

    except Exception as e:
        frappe.log_error(f"Import & Export Expense Report Error: {str(e)}")
        return {
            "success": False,
            "error": str(e),
            "message": _("Failed to fetch Import & Export expense data"),
            "entries": [],
            "totals": {},
        }


@frappe.whitelist()
def get_items_for_import_export_filter():
    """Get distinct item codes used in Landed Cost and Sales Shipment Cost for filter dropdown."""
    try:
        items = set()
        if frappe.db.table_exists("Landed Cost Item"):
            for r in frappe.db.sql(
                "SELECT DISTINCT item_code FROM `tabLanded Cost Item` WHERE item_code IS NOT NULL AND item_code != ''",
                as_dict=True,
            ):
                if r.get("item_code"):
                    items.add(r.get("item_code"))
        if frappe.db.table_exists("Sales Shipment Cost Item"):
            for r in frappe.db.sql(
                "SELECT DISTINCT item_code FROM `tabSales Shipment Cost Item` WHERE item_code IS NOT NULL AND item_code != ''",
                as_dict=True,
            ):
                if r.get("item_code"):
                    items.add(r.get("item_code"))
        item_list = sorted(list(items))
        return {"success": True, "items": [{"name": i, "value": i} for i in item_list]}
    except Exception as e:
        frappe.log_error(f"get_items_for_import_export_filter: {str(e)}")
        return {"success": False, "items": [], "error": str(e)}
