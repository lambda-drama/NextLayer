# Copyright (c) Next Layer. Import & Export Expense Report API.
# OPTIMIZED VERSION — bulk SQL replaces per-document frappe.get_doc() loops
"""
Transit Numbers child doctype schema (on Purchase Invoice / Sales Invoice):
  parenttype    = "Purchase Invoice" or "Sales Invoice"
  parent        = invoice name (e.g. "PINV-0001")
  document_type = doctype of the LINKED invoice (e.g. "Sales Invoice")
  transit_no    = name of the LINKED invoice (e.g. "SINV-0001")

Child table reference (Sales Shipment Cost):
  purchase_receipts → "Landed Cost Sales Invoice"
  taxes             → "Shipment Cost Distribution"
  items             → "Sales Shipment Cost Item"
"""

import frappe
from frappe import _
from frappe.utils import flt
from collections import defaultdict
from nextlayer.next_layer.api.currency_converter import convert as convert_currency


# ─────────────────────────────────────────────────────────────────────────────
# Utility helpers
# ─────────────────────────────────────────────────────────────────────────────

def _safe_get(doc, fieldname, default=""):
    if doc is None:
        return default
    val = doc.get(fieldname)
    return val if val is not None and val != "" else default


def _transit_table_exists():
    return frappe.db.table_exists("Transit Numbers")


def _join_unique(values):
    seen = []
    for v in values:
        if v and v not in seen:
            seen.append(v)
    return ", ".join(seen)


def _get_company_currency(company_name):
    if not company_name:
        return "USD"
    return frappe.get_cached_value("Company", company_name, "default_currency") or "USD"


def _parse_item_codes(filters):
    """Normalize `items` array (or legacy `item`) to a list of item_code strings."""
    raw = filters.get("items")
    if isinstance(raw, str) and raw.strip():
        try:
            raw = frappe.parse_json(raw)
        except Exception:
            raw = [raw]
    if not raw:
        one = filters.get("item") or ""
        raw = [one] if str(one).strip() else []
    if not isinstance(raw, (list, tuple)):
        raw = [raw]
    return [str(x).strip() for x in raw if str(x).strip()]


def _sql_in_clause_single(field_sql, codes, param_key_single="item", param_key_multi="items"):
    """Return (sql_fragment, extra_bind_dict). Empty codes → no filter."""
    if not codes:
        return "", {}
    if len(codes) == 1:
        return f" AND {field_sql} = %({param_key_single})s", {param_key_single: codes[0]}
    return f" AND {field_sql} IN %({param_key_multi})s", {param_key_multi: tuple(codes)}


def _company_group_on_purchase_invoice():
    return frappe.db.has_column("Purchase Invoice", "company_group")


def _company_group_on_sales_invoice():
    return frappe.db.has_column("Sales Invoice", "company_group")


def _filter_pi_si_by_company(pi_names, si_names, company_filter):
    """After transit expansion, keep only invoices belonging to the selected company."""
    if not company_filter:
        return list(pi_names or []), list(si_names or [])
    pi_names = list(pi_names or [])
    si_names = list(si_names or [])
    out_pi, out_si = [], []
    if pi_names:
        rows = frappe.db.sql(
            """
            SELECT name FROM `tabPurchase Invoice`
            WHERE name IN %(n)s AND company = %(c)s
            """,
            {"n": pi_names, "c": company_filter},
            as_dict=True,
        )
        out_pi = [r.name for r in rows]
    if si_names:
        rows = frappe.db.sql(
            """
            SELECT name FROM `tabSales Invoice`
            WHERE name IN %(n)s AND company = %(c)s
            """,
            {"n": si_names, "c": company_filter},
            as_dict=True,
        )
        out_si = [r.name for r in rows]
    return out_pi, out_si


def _bulk_invoice_companies(doctype, names):
    """Return {invoice_name: company} for PI or SI."""
    if not names:
        return {}
    table = "Purchase Invoice" if doctype == "Purchase Invoice" else "Sales Invoice"
    rows = frappe.db.sql(
        f"SELECT name, company FROM `tab{table}` WHERE name IN %(n)s",
        {"n": list(names)},
        as_dict=True,
    )
    return {r.name: (r.company or "") for r in rows}


def _filter_transit_refs_by_company(refs, company_filter):
    """Drop linked transit invoices that belong to another company."""
    if not company_filter or not refs:
        return refs
    pi_names = [r["name"] for r in refs if r.get("doctype") == "Purchase Invoice"]
    si_names = [r["name"] for r in refs if r.get("doctype") == "Sales Invoice"]
    pi_co = _bulk_invoice_companies("Purchase Invoice", pi_names)
    si_co = _bulk_invoice_companies("Sales Invoice", si_names)
    out = []
    for r in refs:
        dt, nm = r.get("doctype"), r.get("name")
        if dt == "Purchase Invoice":
            co = pi_co.get(nm)
        elif dt == "Sales Invoice":
            co = si_co.get(nm)
        else:
            co = None
        if co == company_filter:
            out.append(r)
    return out


def _empty_import_aggregate(target_currency=None):
    return {
        "item_costs": defaultdict(float),
        "item_names": {},
        "posting_dates": [],
        "distribution_lines": [],
        "total_charges": 0.0,
        "target_currency": target_currency,
        "lcv_names": [],
    }


def _empty_export_aggregate():
    return {
        "item_costs": defaultdict(float),
        "item_names": {},
        "posting_dates": [],
        "distribution_lines": [],
        "total_charges": 0.0,
        "currency": "USD",
        "ssc_names": [],
    }


def _collect_transit_display(pi_names, si_names, company_filter=None):
    refs = _collect_transit_invoices_structured(pi_names, si_names, company_filter)
    return ", ".join(r["name"] for r in refs)


def _collect_transit_invoices_structured(pi_names, si_names, company_filter=None):
    """
    Ordered unique linked invoices for Transit No. column (styling + ERPNext links).
    When Transit Numbers child rows exist, use their document_type + transit_no.
    Otherwise fall back to journey PI/SI names.
    If company_filter is set, linked invoices from other companies are omitted.
    """
    out = []
    seen = set()

    if _transit_table_exists():
        if pi_names:
            rows = frappe.db.sql("""
                SELECT document_type, transit_no FROM `tabTransit Numbers`
                WHERE parent IN %(pi)s AND parenttype='Purchase Invoice'
                  AND document_type IS NOT NULL AND transit_no IS NOT NULL
                  AND document_type != '' AND transit_no != ''
            """, {"pi": pi_names}, as_dict=True)
            for r in rows:
                key = (r.document_type, r.transit_no)
                if key not in seen:
                    seen.add(key)
                    out.append({"doctype": r.document_type, "name": r.transit_no})

        if si_names:
            rows = frappe.db.sql("""
                SELECT document_type, transit_no FROM `tabTransit Numbers`
                WHERE parent IN %(si)s AND parenttype='Sales Invoice'
                  AND document_type IS NOT NULL AND transit_no IS NOT NULL
                  AND document_type != '' AND transit_no != ''
            """, {"si": si_names}, as_dict=True)
            for r in rows:
                key = (r.document_type, r.transit_no)
                if key not in seen:
                    seen.add(key)
                    out.append({"doctype": r.document_type, "name": r.transit_no})

    if not out:
        si_list = sorted(si_names or [])
        pi_list = sorted(pi_names or [])
        if company_filter:
            si_co = _bulk_invoice_companies("Sales Invoice", si_list)
            pi_co = _bulk_invoice_companies("Purchase Invoice", pi_list)
            si_list = [n for n in si_list if si_co.get(n) == company_filter]
            pi_list = [n for n in pi_list if pi_co.get(n) == company_filter]
        for n in si_list:
            key = ("Sales Invoice", n)
            if key not in seen:
                seen.add(key)
                out.append({"doctype": "Sales Invoice", "name": n})
        for n in pi_list:
            key = ("Purchase Invoice", n)
            if key not in seen:
                seen.add(key)
                out.append({"doctype": "Purchase Invoice", "name": n})
    elif company_filter:
        out = _filter_transit_refs_by_company(out, company_filter)
        if not out:
            si_list = sorted(si_names or [])
            pi_list = sorted(pi_names or [])
            si_co = _bulk_invoice_companies("Sales Invoice", si_list)
            pi_co = _bulk_invoice_companies("Purchase Invoice", pi_list)
            si_list = [n for n in si_list if si_co.get(n) == company_filter]
            pi_list = [n for n in pi_list if pi_co.get(n) == company_filter]
            for n in si_list:
                out.append({"doctype": "Sales Invoice", "name": n})
            for n in pi_list:
                out.append({"doctype": "Purchase Invoice", "name": n})

    return out


# ─────────────────────────────────────────────────────────────────────────────
# Transit journey graph traversal (BFS) — bulk-query version
# ─────────────────────────────────────────────────────────────────────────────

def _get_transit_neighbors_bulk(nodes):
    """
    Given a list of (doctype, name) tuples, return all their neighbors in ONE
    SQL round-trip per direction instead of one per node.

    Returns: dict[(doctype, name)] → set of (doctype, name)
    """
    if not _transit_table_exists() or not nodes:
        return {}

    neighbors = defaultdict(set)

    # Forward: parent → (document_type, transit_no)
    by_type = defaultdict(list)
    for dt, n in nodes:
        by_type[dt].append(n)

    for dt, names in by_type.items():
        rows = frappe.db.sql("""
            SELECT parent, parenttype, document_type, transit_no
            FROM `tabTransit Numbers`
            WHERE parenttype = %(dt)s AND parent IN %(names)s
              AND document_type IS NOT NULL AND transit_no IS NOT NULL
              AND document_type != '' AND transit_no != ''
        """, {"dt": dt, "names": names}, as_dict=True)
        for r in rows:
            neighbors[(r.parenttype, r.parent)].add((r.document_type, r.transit_no))

    # Reverse: transit_no → (parenttype, parent)
    all_names = [n for _, n in nodes]
    rev_rows = frappe.db.sql("""
        SELECT parent, parenttype, transit_no
        FROM `tabTransit Numbers`
        WHERE transit_no IN %(names)s
          AND parent IS NOT NULL AND parenttype IS NOT NULL
    """, {"names": all_names}, as_dict=True)
    for r in rev_rows:
        # find which node(s) have this transit_no as their name
        for dt, n in nodes:
            if n == r.transit_no:
                neighbors[(dt, n)].add((r.parenttype, r.parent))

    return neighbors


def _get_journey_component(start_doctype, start_name):
    """BFS — return frozenset of all (doctype, name) in the same journey.
    Uses bulk neighbor lookup per BFS frontier to minimise round-trips."""
    visited = set()
    frontier = [(start_doctype, start_name)]

    while frontier:
        # Bulk-fetch neighbors for the entire current frontier
        neighbor_map = _get_transit_neighbors_bulk(frontier)
        visited.update(frontier)
        next_frontier = []
        for node in frontier:
            for nb in neighbor_map.get(node, set()):
                if nb not in visited:
                    next_frontier.append(nb)
        frontier = list(set(next_frontier) - visited)

    return frozenset(visited)


# ─────────────────────────────────────────────────────────────────────────────
# Journey grouping
# ─────────────────────────────────────────────────────────────────────────────

def _parse_draft_mode(filters):
    """
    submitted (default): docstatus = 1 only.
    all: docstatus 0 and 1.
    draft_only: docstatus = 0 only.
    """
    v = (filters.get("draft_mode") or filters.get("document_status") or "").strip().lower()
    if v in ("all", "both", "submitted_and_draft", "include_draft", "with_draft"):
        return "all"
    if v in ("draft", "draft_only", "drafts"):
        return "draft_only"
    return "submitted"


def _pi_si_docstatus_filter(draft_mode):
    """Return (operator, value) for frappe.get_all Purchase/Sales Invoice docstatus."""
    dm = (draft_mode or "submitted").strip().lower()
    if dm == "all":
        return "in", [0, 1]
    if dm == "draft_only":
        return "=", 0
    return "=", 1


def _lcv_docstatus_sql(draft_mode):
    dm = (draft_mode or "submitted").strip().lower()
    if dm == "all":
        return "lcv.docstatus IN (0, 1)"
    if dm == "draft_only":
        return "lcv.docstatus = 0"
    return "lcv.docstatus = 1"


def _ssc_docstatus_sql(draft_mode):
    dm = (draft_mode or "submitted").strip().lower()
    if dm == "all":
        return "ssc.docstatus IN (0, 1)"
    if dm == "draft_only":
        return "ssc.docstatus = 0"
    return "ssc.docstatus = 1"


def _build_journey_map(from_date, to_date, company_filter, company_group_filter=None, draft_mode="submitted"):
    """
    Returns:
        journey_to_pi:   dict[journey_id → list[pi_name]]
        journey_to_si:   dict[journey_id → list[si_name]]
        journey_display: dict[journey_id → display_label]
    """
    journey_to_pi   = defaultdict(list)
    journey_to_si   = defaultdict(list)
    journey_display = {}
    seen_components = {}
    visited_nodes   = set()

    pi_filters = [
        ["Purchase Invoice", "posting_date",          "between", [from_date, to_date]],
        ["Purchase Invoice", "custom_is_export_sale", "=",       1],
    ]
    ds_op, ds_val = _pi_si_docstatus_filter(draft_mode)
    if ds_op == "in":
        pi_filters.append(["Purchase Invoice", "docstatus", "in", ds_val])
    else:
        pi_filters.append(["Purchase Invoice", "docstatus", ds_op, ds_val])
    if company_filter:
        pi_filters.append(["Purchase Invoice", "company", "=", company_filter])
    if company_group_filter and _company_group_on_purchase_invoice():
        pi_filters.append(["Purchase Invoice", "company_group", "=", company_group_filter])

    si_filters = [
        ["Sales Invoice", "posting_date",          "between", [from_date, to_date]],
        ["Sales Invoice", "custom_is_export_sale", "=",       1],
    ]
    ds_op_si, ds_val_si = _pi_si_docstatus_filter(draft_mode)
    if ds_op_si == "in":
        si_filters.append(["Sales Invoice", "docstatus", "in", ds_val_si])
    else:
        si_filters.append(["Sales Invoice", "docstatus", ds_op_si, ds_val_si])
    if company_filter:
        si_filters.append(["Sales Invoice", "company", "=", company_filter])
    if company_group_filter and _company_group_on_sales_invoice():
        si_filters.append(["Sales Invoice", "company_group", "=", company_group_filter])

    seed_nodes = set()
    for row in frappe.get_all("Purchase Invoice", filters=pi_filters, fields=["name"]):
        if row.get("name"):
            seed_nodes.add(("Purchase Invoice", row["name"]))
    for row in frappe.get_all("Sales Invoice", filters=si_filters, fields=["name"]):
        if row.get("name"):
            seed_nodes.add(("Sales Invoice", row["name"]))

    for (doctype, name) in seed_nodes:
        if (doctype, name) in visited_nodes:
            continue

        component = _get_journey_component(doctype, name)

        if component not in seen_components:
            first_dt, first_name = sorted(component)[0]
            jid = f"{first_dt}|{first_name}"
            seen_components[component] = jid
            journey_display[jid] = first_name
        else:
            jid = seen_components[component]

        visited_nodes.update(component)

        for (dt, n) in component:
            if (dt, n) not in seed_nodes:
                continue
            if dt == "Purchase Invoice":
                if n not in journey_to_pi[jid]:
                    journey_to_pi[jid].append(n)
            elif dt == "Sales Invoice":
                if n not in journey_to_si[jid]:
                    journey_to_si[jid].append(n)

    return journey_to_pi, journey_to_si, journey_display


# ─────────────────────────────────────────────────────────────────────────────
# Container / B/L / Destination — bulk SQL
# ─────────────────────────────────────────────────────────────────────────────

def _collect_import_meta_bulk(pi_names):
    """Return (containers_str, bls_str) for ALL pi_names in one query."""
    if not pi_names:
        return "", ""
    rows = frappe.db.sql("""
        SELECT custom_container_no, custom_bill_of_landing
        FROM `tabPurchase Invoice`
        WHERE name IN %(names)s
    """, {"names": pi_names}, as_dict=True)
    containers = _join_unique([r.custom_container_no or "" for r in rows])
    bls        = _join_unique([r.custom_bill_of_landing or "" for r in rows])
    return containers, bls


def _collect_export_meta_bulk(si_names):
    """Return (containers_str, bls_str, destinations_str) for ALL si_names in one query."""
    if not si_names:
        return "", "", ""
    rows = frappe.db.sql("""
        SELECT custom_container_no, custom_bill_of_landing, custom_destination
        FROM `tabSales Invoice`
        WHERE name IN %(names)s
    """, {"names": si_names}, as_dict=True)
    containers   = _join_unique([r.custom_container_no or "" for r in rows])
    bls          = _join_unique([r.custom_bill_of_landing or "" for r in rows])
    destinations = _join_unique([r.custom_destination or "" for r in rows])
    return containers, bls, destinations


# ─────────────────────────────────────────────────────────────────────────────
# Units / Price / Total Value — bulk SQL on SI item rows
# ─────────────────────────────────────────────────────────────────────────────

def _collect_si_item_data_bulk(si_names, item_codes, split_by_uom=False):
    """
    Return {item_code: {units, price, total_value, transaction_currency, company_currency, stock_uom?}}.
    If split_by_uom=True, returns {f"{item_code}||{uom}": {...}} with one entry per item_code × stock_uom.
    item_codes: optional list; empty = all items.
    """
    if not si_names:
        return {}

    # Fetch SI header currency info in one shot
    si_meta_rows = frappe.db.sql("""
        SELECT name, currency, company
        FROM `tabSales Invoice`
        WHERE name IN %(names)s
    """, {"names": si_names}, as_dict=True)

    si_currency_map = {r.name: r.currency or "USD" for r in si_meta_rows}
    si_company_map  = {r.name: r.company or "" for r in si_meta_rows}

    uom_sql = ", sii.stock_uom, sii.uom" if split_by_uom else ""
    item_frag, item_bind = _sql_in_clause_single("sii.item_code", item_codes or [])
    if frappe.db.has_column("Sales Invoice Item", "stock_qty"):
        qty_sel = "IFNULL(NULLIF(IFNULL(sii.stock_qty, 0), 0), IFNULL(sii.qty, 0))"
    else:
        qty_sel = "IFNULL(sii.qty, 0)"
    rows = frappe.db.sql(f"""
        SELECT sii.parent, sii.item_code, {qty_sel} AS qty, sii.rate, sii.amount{uom_sql}
        FROM `tabSales Invoice Item` sii
        WHERE sii.parent IN %(names)s
          {item_frag}
          AND sii.item_code IS NOT NULL AND sii.item_code != ''
    """, {"names": si_names, **item_bind}, as_dict=True)

    item_data = {}
    for r in rows:
        ic = r.item_code
        uom_key = ic
        if split_by_uom:
            raw_uom = (r.get("stock_uom") or r.get("uom") or "").strip() or "—"
            uom_key = f"{ic}||{raw_uom}"

        if uom_key not in item_data:
            tc = si_currency_map.get(r.parent, "USD")
            cc = _get_company_currency(si_company_map.get(r.parent, ""))
            item_data[uom_key] = {
                "item_code":            ic,
                "si_invoice":           r.parent,
                "stock_uom":            (r.get("stock_uom") or r.get("uom") or "").strip() or None,
                "units":                0.0,
                "price":                0.0,
                "total_value":          0.0,
                "transaction_currency": tc,
                "company_currency":     cc,
            }
        item_data[uom_key]["units"]       += flt(r.qty, 2)
        item_data[uom_key]["price"]        = flt(r.rate, 2)
        item_data[uom_key]["total_value"] += flt(r.amount, 2)
        p = r.parent or ""
        if p:
            seen = [x.strip() for x in (item_data[uom_key].get("si_invoice") or "").split(",") if x.strip()]
            if p not in seen:
                seen.append(p)
                item_data[uom_key]["si_invoice"] = ", ".join(seen)

    return item_data


# ─────────────────────────────────────────────────────────────────────────────
# Item name cache — one bulk lookup per report run
# ─────────────────────────────────────────────────────────────────────────────

def _bulk_item_names(item_codes):
    """Return {item_code: item_name} for all given codes in one query."""
    if not item_codes:
        return {}
    rows = frappe.db.sql("""
        SELECT name, item_name FROM `tabItem`
        WHERE name IN %(codes)s
    """, {"codes": list(item_codes)}, as_dict=True)
    return {r.name: r.item_name or r.name for r in rows}


# def _aggregate_import_costs_bulk(pi_names, company_filter, item_filter):
#     """Return ALL distribution lines grouped by expense account"""
#     if not pi_names:
#         return {
#             "item_costs": defaultdict(float),
#             "item_names": {},
#             "posting_dates": [],
#             "distribution_lines": [],
#             "total_charges": 0.0,
#             "company_currency": None,
#             "lcv_names": [],
#         }

#     company_clause = "AND lcv.company = %(company)s" if company_filter else ""

#     # Step 1: find matching LCVs and get their total_taxes_and_charges
#     lcv_rows = frappe.db.sql(f"""
#         SELECT DISTINCT
#             lcv.name AS lcv_name,
#             lcv.company AS lcv_company,
#             lcv.posting_date AS posting_date,
#             lcv.total_taxes_and_charges AS total_taxes_and_charges
#         FROM `tabLanded Cost Voucher` lcv
#         INNER JOIN `tabLanded Cost Purchase Receipt` lcpr
#             ON lcpr.parent = lcv.name
#         WHERE lcv.docstatus = 1
#           AND lcpr.receipt_document_type = 'Purchase Invoice'
#           AND lcpr.receipt_document IN %(pi_names)s
#           {company_clause}
#         ORDER BY lcv.posting_date ASC
#     """, {"pi_names": pi_names, "company": company_filter}, as_dict=True)

#     if not lcv_rows:
#         return {
#             "item_costs": defaultdict(float),
#             "item_names": {},
#             "posting_dates": [],
#             "distribution_lines": [],
#             "total_charges": 0.0,
#             "company_currency": None,
#             "lcv_names": [],
#         }

#     lcv_names = [r.lcv_name for r in lcv_rows]
#     company_currency = _get_company_currency(lcv_rows[0].lcv_company) if lcv_rows else "USD"
#     posting_dates = [str(r.posting_date or "") for r in lcv_rows]
    
#     # Sum the total_taxes_and_charges from all LCVs (this is the TRUE total)
#     total_charges_sum = sum([flt(r.total_taxes_and_charges, 2) for r in lcv_rows])

#     # Step 2: Get ALL distribution lines (taxes and charges) for display in ChargeStack
#     distribution_lines = []
#     if frappe.db.table_exists("Landed Cost Taxes and Charges"):
#         tax_rows = frappe.db.sql("""
#             SELECT expense_account, description, base_amount
#             FROM `tabLanded Cost Taxes and Charges`
#             WHERE parent IN %(lcv_names)s
#         """, {"lcv_names": lcv_names}, as_dict=True)
        
#         for t in tax_rows:
#             amt = flt(t.base_amount, 2)
#             distribution_lines.append({
#                 "expense_account": t.expense_account or "",
#                 "description": t.description or "",
#                 "amount": amt
#             })

#     # Step 3: Get item-level charges (for per-item breakdown)
#     item_clause = "AND lci.item_code = %(item)s" if item_filter else ""
#     item_rows = frappe.db.sql(f"""
#         SELECT lci.item_code, lci.applicable_charges, lci.description
#         FROM `tabLanded Cost Item` lci
#         WHERE lci.parent IN %(lcv_names)s
#           AND lci.item_code IS NOT NULL AND lci.item_code != ''
#           {item_clause}
#     """, {"lcv_names": lcv_names, "item": item_filter}, as_dict=True)

#     item_costs = defaultdict(float)
#     item_names = {}
#     for r in item_rows:
#         ic = r.item_code
#         amt = flt(r.applicable_charges, 2)
#         item_costs[ic] += amt
#         if ic not in item_names:
#             item_names[ic] = r.description or ic

#     return {
#         "item_costs": item_costs,
#         "item_names": item_names,
#         "posting_dates": posting_dates,
#         "distribution_lines": distribution_lines,  # ALL expense accounts (for display only)
#         "total_charges": total_charges_sum,  # Using LCV.total_taxes_and_charges (TRUE total)
#         "company_currency": company_currency,
#         "lcv_names": lcv_names
#     }

def _aggregate_import_costs_bulk(
    pi_names,
    company_filter,
    item_codes=None,
    target_currency=None,
    conversion_date=None,
    draft_mode="submitted",
):
    """
    Return ALL distribution lines grouped by expense account.

    Currency handling for Imports (Landed Cost Voucher):
    - Each LCV can be from a different company with different company currency
    - ALL amounts are converted to target_currency (from user's filter)
    - target_currency is the display currency selected in the report filters
    """
    item_codes = item_codes or []
    if not pi_names:
        return {
            "item_costs": defaultdict(float),
            "item_names": {},
            "posting_dates": [],
            "distribution_lines": [],
            "total_charges": 0.0,
            "target_currency": target_currency,
            "lcv_names": [],
        }

    company_clause = "AND lcv.company = %(company)s" if company_filter else ""
    lcv_ds_clause = _lcv_docstatus_sql(draft_mode)

    # Step 1: find matching LCVs with company info
    lcv_rows = frappe.db.sql(f"""
        SELECT DISTINCT
            lcv.name AS lcv_name,
            lcv.company AS lcv_company,
            lcv.posting_date AS posting_date,
            lcv.total_taxes_and_charges AS total_taxes_and_charges
        FROM `tabLanded Cost Voucher` lcv
        INNER JOIN `tabLanded Cost Purchase Receipt` lcpr
            ON lcpr.parent = lcv.name
        WHERE {lcv_ds_clause}
          AND lcpr.receipt_document_type = 'Purchase Invoice'
          AND lcpr.receipt_document IN %(pi_names)s
          {company_clause}
        ORDER BY lcv.posting_date ASC
    """, {"pi_names": pi_names, "company": company_filter}, as_dict=True)

    if not lcv_rows:
        return {
            "item_costs": defaultdict(float),
            "item_names": {},
            "posting_dates": [],
            "distribution_lines": [],
            "total_charges": 0.0,
            "target_currency": target_currency,
            "lcv_names": [],
        }

    lcv_names = [r.lcv_name for r in lcv_rows]
    posting_dates = [str(r.posting_date or "") for r in lcv_rows]
    
    # If no target currency provided, use first LCV's company currency as fallback
    if not target_currency:
        target_currency = _get_company_currency(lcv_rows[0].lcv_company) if lcv_rows else "USD"
    
    # Convert and sum total_taxes_and_charges from all LCVs to target_currency
    total_charges_sum = 0.0
    
    for r in lcv_rows:
        lcv_company_currency = _get_company_currency(r.lcv_company)
        amt_in_lcv_currency = flt(r.total_taxes_and_charges, 2)
        
        # Convert to target currency if different
        if lcv_company_currency != target_currency:
            try:
                conversion_date_use = conversion_date or r.posting_date or frappe.utils.nowdate()
                converted_amount = flt(
                    convert_currency(amt_in_lcv_currency, target_currency, lcv_company_currency, conversion_date_use),
                    2
                )
                total_charges_sum += converted_amount
            except Exception as e:
                # If conversion fails, use original amount but log error
                total_charges_sum += amt_in_lcv_currency
                frappe.log_error(
                    f"Import LCV conversion failed for {r.lcv_name}: {amt_in_lcv_currency} {lcv_company_currency} -> {target_currency}. Error: {str(e)}"
                )
        else:
            total_charges_sum += amt_in_lcv_currency

    # Step 2: Get ALL distribution lines and convert to target_currency
    distribution_lines = []
    if frappe.db.table_exists("Landed Cost Taxes and Charges"):
        tax_rows = frappe.db.sql("""
            SELECT 
                lctc.parent AS lcv_name,
                lctc.expense_account, 
                lctc.description, 
                lctc.base_amount,        -- Already in company currency of the LCV
                lctc.amount,             -- Original amount in account_currency
                lctc.account_currency,
                lcv.company AS lcv_company
            FROM `tabLanded Cost Taxes and Charges` lctc
            INNER JOIN `tabLanded Cost Voucher` lcv ON lcv.name = lctc.parent
            WHERE lctc.parent IN %(lcv_names)s
        """, {"lcv_names": lcv_names}, as_dict=True)
        
        for t in tax_rows:
            # Get the company currency for this specific LCV
            lcv_company_currency = _get_company_currency(t.lcv_company)
            amt_in_lcv_currency = flt(t.base_amount, 2)
            
            # Convert to target currency if needed
            if lcv_company_currency != target_currency:
                try:
                    conversion_date_use = conversion_date or frappe.utils.nowdate()
                    amt_converted = flt(
                        convert_currency(amt_in_lcv_currency, target_currency, lcv_company_currency, conversion_date_use),
                        2
                    )
                except Exception:
                    amt_converted = amt_in_lcv_currency
            else:
                amt_converted = amt_in_lcv_currency
            
            # Build label with original currency context for transparency
            original_info = ""
            if t.account_currency and t.account_currency != lcv_company_currency:
                original_info = f" (Original: {flt(t.amount, 2)} {t.account_currency})"
            
            distribution_lines.append({
                "expense_account": t.expense_account or "",
                "description": f"{t.description or ''}{original_info}",
                "amount": amt_converted,  # Now in target_currency
                "original_currency": t.account_currency,
                "original_amount": flt(t.amount, 2),
                "lcv_company_currency": lcv_company_currency,
                "lcv_name": t.lcv_name,
            })

    # Step 3: Get item-level charges and convert to target_currency
    item_frag, item_bind = _sql_in_clause_single("lci.item_code", item_codes)
    item_rows = frappe.db.sql(f"""
        SELECT 
            lci.item_code, 
            lci.applicable_charges,
            lci.description,
            lcv.company AS lcv_company,
            lci.parent AS lcv_name
        FROM `tabLanded Cost Item` lci
        INNER JOIN `tabLanded Cost Voucher` lcv ON lcv.name = lci.parent
        WHERE lci.parent IN %(lcv_names)s
          AND lci.item_code IS NOT NULL AND lci.item_code != ''
          {item_frag}
    """, {"lcv_names": lcv_names, **item_bind}, as_dict=True)

    item_costs = defaultdict(float)
    item_names = {}
    for r in item_rows:
        ic = r.item_code
        lcv_company_currency = _get_company_currency(r.lcv_company)
        amt_in_lcv_currency = flt(r.applicable_charges, 2)
        
        # Convert to target currency if needed
        if lcv_company_currency != target_currency:
            try:
                conversion_date_use = conversion_date or frappe.utils.nowdate()
                amt_converted = flt(
                    convert_currency(amt_in_lcv_currency, target_currency, lcv_company_currency, conversion_date_use),
                    2
                )
            except Exception:
                amt_converted = amt_in_lcv_currency
        else:
            amt_converted = amt_in_lcv_currency
            
        item_costs[ic] += amt_converted
        if ic not in item_names:
            item_names[ic] = r.description or ic

    return {
        "item_costs": item_costs,
        "item_names": item_names,
        "posting_dates": posting_dates,
        "distribution_lines": distribution_lines,
        "total_charges": total_charges_sum,  # Already in target_currency
        "target_currency": target_currency,
        "lcv_names": lcv_names,
    }
    


def _aggregate_export_costs_bulk(si_names, company_filter, item_codes=None, draft_mode="submitted"):
    """Return ALL distribution lines grouped by expense account"""
    item_codes = item_codes or []
    if not si_names or not frappe.db.table_exists("Sales Shipment Cost"):
        return {
            "item_costs": defaultdict(float),
            "item_names": {},
            "posting_dates": [],
            "distribution_lines": [],
            "total_charges": 0.0,
            "currency": "USD",
            "ssc_names": [],
        }

    company_clause = "AND ssc.company = %(company)s" if company_filter else ""
    ssc_ds_clause = _ssc_docstatus_sql(draft_mode)

    # Step 1: find matching SSCs and get their total_amount
    ssc_rows = frappe.db.sql(f"""
        SELECT DISTINCT 
            ssc.name AS ssc_name, 
            ssc.posting_date,
            ssc.total_taxes_and_charges AS total_amount
        FROM `tabSales Shipment Cost` ssc
        INNER JOIN `tabLanded Cost Sales Invoice` lcsi
            ON lcsi.parent = ssc.name
        WHERE {ssc_ds_clause}
          AND lcsi.receipt_document_type = 'Sales Invoice'
          AND lcsi.receipt_document IN %(si_names)s
          {company_clause}
        ORDER BY ssc.posting_date ASC
    """, {"si_names": si_names, "company": company_filter}, as_dict=True)

    if not ssc_rows:
        return {
            "item_costs": defaultdict(float),
            "item_names": {},
            "posting_dates": [],
            "distribution_lines": [],
            "total_charges": 0.0,
            "currency": "USD",
            "ssc_names": [],
        }
    
    ssc_names = [r.ssc_name for r in ssc_rows]
    posting_dates = [str(r.posting_date or "") for r in ssc_rows]
    # Use total_amount from the SSC document (this is the TRUE total)
    # This matches what ERPNext calculates as the total landed cost for exports
    total_charges_sum = sum([flt(r.total_amount, 2) for r in ssc_rows])

    # Step 2: Get ALL distribution lines for display in ChargeStack (no keyword filtering)
    distribution_lines = []
    
    # Check both possible table names (different ERPNext versions might use different names)
    tax_table = None
    if frappe.db.table_exists("Sales Landed Cost Taxes and Charges"):
        tax_table = "Sales Landed Cost Taxes and Charges"
    elif frappe.db.table_exists("Shipment Cost Distribution"):
        tax_table = "Shipment Cost Distribution"
    
    if tax_table:
        tax_rows = frappe.db.sql(f"""
            SELECT expense_account, description, amount
            FROM `tab{tax_table}`
            WHERE parent IN %(ssc_names)s
        """, {"ssc_names": ssc_names}, as_dict=True)
        
        for t in tax_rows:
            amt = flt(t.amount, 2)
            distribution_lines.append({
                "expense_account": t.expense_account or "",
                "description": t.description or "",
                "amount": amt
            })

    # Step 3: Get item-level charges (for per-item breakdown)
    item_frag, item_bind = _sql_in_clause_single("item_code", item_codes)
    item_rows = frappe.db.sql(f"""
        SELECT item_code, applicable_charges, description
        FROM `tabSales Shipment Cost Item`
        WHERE parent IN %(ssc_names)s
          AND item_code IS NOT NULL AND item_code != ''
          {item_frag}
    """, {"ssc_names": ssc_names, **item_bind}, as_dict=True)

    item_costs = defaultdict(float)
    item_names = {}
    for r in item_rows:
        ic = r.item_code
        amt = flt(r.applicable_charges, 2)
        item_costs[ic] += amt
        if ic not in item_names:
            item_names[ic] = r.description or ic

    return {
        "item_costs": item_costs,
        "item_names": item_names,
        "posting_dates": posting_dates,
        "distribution_lines": distribution_lines,  # ALL expense accounts (for display only)
        "total_charges": total_charges_sum,  # Using SSC.total_amount (TRUE total from ERPNext)
        "currency": "USD",
        "ssc_names": ssc_names
    }

# ─────────────────────────────────────────────────────────────────────────────
# Expand journey component
# ─────────────────────────────────────────────────────────────────────────────

def _expand_journey_invoices(pi_names, si_names):
    all_pi = set(pi_names)
    all_si = set(si_names)
    seeds  = (
        [("Purchase Invoice", n) for n in pi_names] +
        [("Sales Invoice",    n) for n in si_names]
    )
    for doctype, name in seeds:
        for (dt, n) in _get_journey_component(doctype, name):
            if dt == "Purchase Invoice":
                all_pi.add(n)
            elif dt == "Sales Invoice":
                all_si.add(n)
    return list(all_pi), list(all_si)


# ─────────────────────────────────────────────────────────────────────────────
# Container slices / expense breakdown lines
# ─────────────────────────────────────────────────────────────────────────────

def _cluster_journey_slices(all_pi_names, all_si_names, group_by_container):
    """
    Split expanded PI/SI sets per distinct shipping container when requested.
    Invoices without custom_container_no bucket together under \"No container\".
    """
    if not group_by_container:
        return [{
            "suffix":       "",
            "pi_names":     list(all_pi_names or []),
            "si_names":     list(all_si_names or []),
            "label_suffix": "",
        }]

    pi_c = {}
    si_c = {}
    if all_pi_names:
        for r in frappe.db.sql("""
            SELECT name AS inv_name,
                   NULLIF(NULLIF(TRIM(IFNULL(custom_container_no, '')), ''), '') AS ctn
            FROM `tabPurchase Invoice`
            WHERE name IN %(n)s
        """, {"n": list(all_pi_names)}, as_dict=True):
            pi_c[r.inv_name] = r.ctn or ""
    if all_si_names:
        for r in frappe.db.sql("""
            SELECT name AS inv_name,
                   NULLIF(NULLIF(TRIM(IFNULL(custom_container_no, '')), ''), '') AS ctn
            FROM `tabSales Invoice`
            WHERE name IN %(n)s
        """, {"n": list(all_si_names)}, as_dict=True):
            si_c[r.inv_name] = r.ctn or ""

    buckets_pi = defaultdict(list)
    buckets_si = defaultdict(list)
    for n in all_pi_names or []:
        buckets_pi[pi_c.get(n, "")].append(n)
    for n in all_si_names or []:
        buckets_si[si_c.get(n, "")].append(n)

    all_buckets = sorted(set(buckets_pi.keys()) | set(buckets_si.keys()))
    slices = []
    for b in all_buckets:
        pis = buckets_pi.get(b, [])
        sis = buckets_si.get(b, [])
        if not pis and not sis:
            continue
        safe = (b or "__none__").replace("|", "/")
        slices.append({
            "suffix":       f"|ctr:{safe}",
            "pi_names":     pis,
            "si_names":     sis,
            "label_suffix": b if b else _("No container"),
        })
    return slices if slices else [{
        "suffix": "",
        "pi_names": list(all_pi_names or []),
        "si_names": list(all_si_names or []),
        "label_suffix": "",
    }]


def _lcv_distribution_lines(lcv_names):
    """LCV taxes — expense accounts / descriptions driving landed cost."""
    if not lcv_names or not frappe.db.table_exists("Landed Cost Taxes and Charges"):
        return []
    rows = frappe.db.sql("""
        SELECT expense_account, description, IFNULL(amount, 0) AS amount
        FROM `tabLanded Cost Taxes and Charges`
        WHERE parent IN %(p)s AND IFNULL(amount, 0) != 0
        ORDER BY expense_account ASC, description ASC
    """, {"p": list(lcv_names)}, as_dict=True)
    out = []
    for r in rows:
        ac = r.expense_account or ""
        ds = (r.description or "").strip()
        lbl = f"{ac} — {ds}" if ac and ds else (ac or ds or _("Charge"))
        out.append({
            "expense_account": ac or None,
            "description":     ds or None,
            "label":           lbl,
            "amount":          flt(r.amount, 2),
        })
    return out


def _ssc_distribution_lines(ssc_names):
    """Shipment Cost Distribution rows on Sales Shipment Cost."""
    if not ssc_names or not frappe.db.table_exists("Shipment Cost Distribution"):
        return []
    rows = frappe.db.sql("""
        SELECT expense_account, description, IFNULL(amount, 0) AS amount
        FROM `tabShipment Cost Distribution`
        WHERE parent IN %(p)s AND IFNULL(amount, 0) != 0
        ORDER BY description ASC, expense_account ASC
    """, {"p": list(ssc_names)}, as_dict=True)
    out = []
    for r in rows:
        ac = r.expense_account or ""
        ds = (r.description or "").strip()
        lbl = f"{ac} — {ds}" if ac and ds else (ac or ds or _("Charge"))
        out.append({
            "expense_account": ac or None,
            "description":     ds or None,
            "label":           lbl,
            "amount":          flt(r.amount, 2),
        })
    return out


def _distribution_lines_for_api(raw_rows):
    """Normalize aggregate child-table rows to API / ChargeStack shape."""
    out = []
    for r in raw_rows or []:
        ac = r.get("expense_account") or ""
        ds = (r.get("description") or "").strip()
        lbl = f"{ac} — {ds}" if ac and ds else (ac or ds or _("Charge"))
        out.append({
            "expense_account": ac or None,
            "description":     ds or None,
            "label":           lbl,
            "amount":          flt(r.get("amount") or 0, 2),
        })
    return out


def _convert_distribution_lines(lines, display_currency, from_currency, conversion_date):
    if not lines or not display_currency or not from_currency:
        return lines
    out = []
    for ln in lines:
        amt = flt(ln.get("amount") or 0, 2)
        try:
            conv = flt(convert_currency(amt, display_currency, from_currency, conversion_date), 2)
        except Exception:
            conv = amt
        row = dict(ln)
        row["amount"] = conv
        out.append(row)
    return out


def _iter_row_specs(import_item_costs, export_item_costs, si_item_data, split_by_uom):
    """Yield per-row cost / SI meta; splits import+export charges by qty share when split_by_uom."""
    ic_to_si_keys = defaultdict(list)
    for k, meta in (si_item_data or {}).items():
        ic = meta.get("item_code")
        if ic:
            ic_to_si_keys[ic].append((k, meta))

    base_codes = sorted(
        set(import_item_costs.keys())
        | set(export_item_costs.keys())
        | set(ic_to_si_keys.keys()),
    )

    if not split_by_uom:
        for ic in base_codes:
            yield {
                "entry_row_key": ic,
                "item_code":     ic,
                "stock_uom":     None,
                "add_costs":     flt(import_item_costs.get(ic, 0), 2),
                "exp_charges":   flt(export_item_costs.get(ic, 0), 2),
                "si_meta":       si_item_data.get(ic, {}),
            }
        return

    ordered = base_codes
    for ic in ordered:
        variants = sorted(ic_to_si_keys.get(ic, []), key=lambda x: x[0])
        imp = flt(import_item_costs.get(ic, 0), 2)
        exp = flt(export_item_costs.get(ic, 0), 2)

        if not variants:
            yield {
                "entry_row_key": ic,
                "item_code":     ic,
                "stock_uom":     None,
                "add_costs":     imp,
                "exp_charges":   exp,
                "si_meta":       {},
            }
            continue

        tot_qty = sum(flt((m[1].get("units") or 0), 2) for m in variants)
        nvar    = len(variants)
        for sk, meta in variants:
            qty = flt(meta.get("units") or 0, 2)
            if tot_qty > 0:
                share = qty / tot_qty
            else:
                share = 1.0 / nvar
            yield {
                "entry_row_key": sk,
                "item_code":     ic,
                "stock_uom":     meta.get("stock_uom"),
                "add_costs":     flt(imp * share, 2),
                "exp_charges":   flt(exp * share, 2),
                "si_meta":       meta,
            }


# ─────────────────────────────────────────────────────────────────────────────
# Row building
# ─────────────────────────────────────────────────────────────────────────────

def _fmt_dates(dates):
    return ", ".join(filter(None, sorted(set(dates))))[:100]


def _export_expenses_native_company_currency(
    exp_charges_usd,
    export_charges_doonta_usd,
    freight_cc,
    storage_cc,
    include_shipment_extras,
    company_currency,
    export_currency,
    conversion_date,
):
    """
    Roll SSC item charges (USD) + freight/storage/Doonta (first row only) into one
    company-currency native amount for a single export-expense column.
    """
    fs = (flt(freight_cc, 2) + flt(storage_cc, 2)) if include_shipment_extras else 0.0
    usd = flt(exp_charges_usd, 2)
    if include_shipment_extras:
        usd += flt(export_charges_doonta_usd or 0, 2)
    if not usd:
        usd_as_cc = 0.0
    else:
        try:
            date = conversion_date or frappe.utils.nowdate()
            usd_as_cc = flt(
                convert_currency(usd, company_currency, export_currency, date),
                2,
            )
        except Exception:
            usd_as_cc = usd
    return fs + usd_as_cc

def _build_journey_rows(
    journey_id, display_name, pi_names, si_names,
    import_data,        # dict with keys: item_costs, item_names, distribution_lines, total_charges, company_currency, lcv_names, posting_dates
    export_data,        # dict with keys: item_costs, item_names, distribution_lines, total_charges, currency, ssc_names, posting_dates
    all_item_names,
    si_item_data,
    transit_no,
    import_container, import_bl,
    export_container, export_bl, destination,
    posting_dates,
    company_currency,
    export_currency="USD",
    display_currency=None,
    conversion_date=None,
    split_by_uom=False,
    expense_side="all",
):
    """
    Build journey rows with complete expense account distribution.
    
    Args:
        import_data: {
            "item_costs": defaultdict(float),           # per-item charges
            "item_names": dict,                         # item_code -> description
            "distribution_lines": list,                 # ALL expense accounts with amounts
            "total_charges": float,                     # sum of all import charges
            "company_currency": str,                    # currency code
            "lcv_names": list,                          # Landed Cost Voucher names
            "posting_dates": list                       # dates for display
        }
        export_data: {
            "item_costs": defaultdict(float),           # per-item charges
            "item_names": dict,                         # item_code -> description
            "distribution_lines": list,                 # ALL expense accounts with amounts
            "total_charges": float,                     # sum of all export charges
            "currency": str,                            # always "USD" for exports
            "ssc_names": list,                          # Sales Shipment Cost names
            "posting_dates": list                       # dates for display
        }
    """
    def _cc(amount, from_currency):
        """Convert amount from from_currency to display_currency if needed."""
        if not display_currency or not amount or from_currency == display_currency:
            return amount
        try:
            date = conversion_date or frappe.utils.nowdate()
            return flt(convert_currency(amount, display_currency, from_currency, date), 2)
        except Exception:
            return amount  # fall back to native value on any rate error

    # Extract from the data dicts
    import_item_costs = import_data.get("item_costs", {})
    export_item_costs = export_data.get("item_costs", {})
    
    # Get distribution lines for ChargeStack component
    import_distribution_lines = import_data.get("distribution_lines", [])
    export_distribution_lines = export_data.get("distribution_lines", [])
    
    # Get totals (sum of ALL charges including distribution lines)
    total_import_charges = import_data.get("total_charges", 0.0)  # This already includes distribution + item charges
    total_export_charges = export_data.get("total_charges", 0.0)  # This already includes distribution + item charges
    
    # Get document names for linking
    lcv_names = import_data.get("lcv_names", [])
    ssc_names = export_data.get("ssc_names", [])
    
    # Determine source type (respect expense-side filter for UI badges)
    es = (expense_side or "all").lower()
    if es == "purchase":
        source = "import" if pi_names else ("export" if si_names else "import")
    elif es == "sales":
        source = "export" if si_names else ("import" if pi_names else "export")
    else:
        source = (
            "both"   if (pi_names and si_names) else
            "import" if pi_names else
            "export"
        )
    
    date_str = _fmt_dates(posting_dates)
    conv_date = conversion_date or frappe.utils.nowdate()
    
    # Effective display currencies
    eff_cc  = display_currency or company_currency
    eff_usd = display_currency or export_currency
    
    # Build per-item/spec rows
    rows = []
    specs = list(_iter_row_specs(import_item_costs, export_item_costs, si_item_data, split_by_uom))
    
    # If no items but there are charges (e.g., only freight/storage without items)
    if not specs and (total_import_charges > 0 or total_export_charges > 0):
        imp_part = _cc(total_import_charges, company_currency) if total_import_charges > 0 else None
        exp_part = _cc(total_export_charges, export_currency) if total_export_charges > 0 else None
        total_disp = flt(flt(imp_part or 0, 2) + flt(exp_part or 0, 2), 2)

        rows.append({
            "journey_id":            journey_id,
            "transit_display":       display_name,
            "transit_no":            transit_no,
            "entry_row_key":         "_other_charges",
            "item_code":             "",
            "item_name":             "",
            "description":           _("Other Charges (Freight, Storage, Handling, etc.)"),
            "stock_uom":             None,
            "units":                 None,
            "price":                 None,
            "total_value":           None,
            "transaction_currency":  eff_cc,
            "posting_date":          date_str,
            "import_container":      import_container or "—",
            "export_container":      export_container or "—",
            "import_bl":             import_bl or "—",
            "export_bl":             export_bl or "—",
            "destination":           destination or "—",
            "freight":               None,
            "storage":               None,
            "export_charges_doonta": None,
            "additional_costs":      imp_part,
            "export_charges":        None,
            "export_expenses":       exp_part,
            "total":                 total_disp,
            "company_currency":      eff_cc,
            "export_currency":       eff_usd,
            "source":                source,
            "sales_invoice":         None,
        })
        return rows
    
    # Normal case: process each item
    for idx, spec in enumerate(specs):
        is_first = idx == 0
        item_code = spec["item_code"]
        entry_key = spec["entry_row_key"]
        
        # Get charges (now includes ALL allocated charges, not just item-level)
        import_charges = flt(spec.get("add_costs", 0), 2)
        export_charges = flt(spec.get("exp_charges", 0), 2)
        
        # Convert to display currency
        import_disp = _cc(import_charges, company_currency) if import_charges > 0 else None
        export_disp = _cc(export_charges, export_currency) if export_charges > 0 else None
        
        # Get SI metadata
        si_meta = spec.get("si_meta", {})
        transaction_currency = si_meta.get("transaction_currency") or company_currency
        eff_tx = display_currency or transaction_currency
        
        total_disp = flt(flt(import_disp or 0, 2) + flt(export_disp or 0, 2), 2)
        
        # Build description
        desc = all_item_names.get(item_code) or spec.get("description") or item_code
        if spec.get("stock_uom"):
            desc = f"{desc} ({spec['stock_uom']})"
        
        rows.append({
            "journey_id":            journey_id,
            "transit_display":       display_name,
            "transit_no":            transit_no,
            "entry_row_key":         entry_key,
            "item_code":             item_code,
            "item_name":             item_code,
            "description":           desc,
            "stock_uom":             spec.get("stock_uom"),
            "units":                 si_meta.get("units") or None,
            "price":                 _cc(si_meta.get("price"), transaction_currency) or None,
            "total_value":           _cc(si_meta.get("total_value"), transaction_currency) or None,
            "transaction_currency":  eff_tx,
            "posting_date":          date_str,
            "import_container":      import_container or "—",
            "export_container":      export_container or "—",
            "import_bl":             import_bl or "—",
            "export_bl":             export_bl or "—",
            "destination":           destination or "—",
            "freight":               None,  # Deprecated - use distribution_lines instead
            "storage":               None,  # Deprecated - use distribution_lines instead
            "export_charges_doonta": None,  # Deprecated - use distribution_lines instead
            "additional_costs":      import_disp,
            "export_charges":        None,
            "export_expenses":       export_disp,
            "total":                 total_disp,
            "company_currency":      eff_cc,
            "export_currency":       eff_usd,
            "source":                source,
            "sales_invoice":         si_meta.get("si_invoice"),
        })
    
    return rows


# ─────────────────────────────────────────────────────────────────────────────
# Public API
# ─────────────────────────────────────────────────────────────────────────────

@frappe.whitelist()
def get_import_export_expense_report(filters=None):
    """Main report endpoint — returns item-based rows grouped by journey."""
    try:
        if filters is None:
            filters = frappe.form_dict
        if isinstance(filters, str):
            filters = frappe.parse_json(filters)
        filters = filters or {}

        from_date = filters.get("from_date")
        to_date   = filters.get("to_date")
        if not from_date or not to_date:
            frappe.throw(_("From Date and To Date are required"))

        company_filter = filters.get("company") or ""
        company_group_filter = (filters.get("company_group") or "").strip()
        currency_filter = filters.get("currency") or ""
        # display_currency: non-empty, non-"all" value means "convert everything to this"
        display_currency = currency_filter if (currency_filter and currency_filter != "all") else None

        item_codes = _parse_item_codes(filters)
        draft_mode = _parse_draft_mode(filters)
        # Legacy boolean include_drafts=true → treat as "all"
        if str(filters.get("include_drafts") or "").lower() in ("1", "true", "yes", "on"):
            draft_mode = "all"
        restrict_transit_to_company = str(filters.get("restrict_transit_to_company") or "").lower() in (
            "1", "true", "yes", "on",
        )
        expense_side = (filters.get("expense_side") or filters.get("expense_scope") or "all").strip().lower()
        if expense_side not in ("all", "purchase", "sales", "import", "export"):
            expense_side = "all"
        if expense_side == "import":
            expense_side = "purchase"
        if expense_side == "export":
            expense_side = "sales"

        gb_raw = (filters.get("group_by") or "default").strip().lower()
        group_by_container = gb_raw in ("container", "containers")
        split_by_uom       = gb_raw in ("unit", "units", "uom")

        journey_to_pi, journey_to_si, journey_display = _build_journey_map(
            from_date,
            to_date,
            company_filter,
            company_group_filter=company_group_filter or None,
            draft_mode=draft_mode,
        )
        all_journey_ids = sorted(set(journey_to_pi.keys()) | set(journey_to_si.keys()))

        entries       = []
        totals        = defaultdict(float)
        journeys_meta = {}

        def _cv_amt(amount, from_currency):
            if amount is None:
                return 0.0
            if not display_currency or not from_currency:
                return flt(amount, 2)
            try:
                return flt(convert_currency(amount, display_currency, from_currency, to_date), 2)
            except Exception:
                return flt(amount, 2)

        for journey_id in all_journey_ids:
            pi_seed = list(set(journey_to_pi.get(journey_id, [])))
            si_seed = list(set(journey_to_si.get(journey_id, [])))
            display_name = journey_display.get(journey_id, journey_id.replace("|", " "))

            all_pi_names, all_si_names = _expand_journey_invoices(pi_seed, si_seed)
            transit_company_arg = (
                company_filter if (company_filter and restrict_transit_to_company) else None
            )
            if transit_company_arg:
                all_pi_names, all_si_names = _filter_pi_si_by_company(
                    all_pi_names, all_si_names, transit_company_arg,
                )
            if not all_pi_names and not all_si_names:
                continue

            for sl in _cluster_journey_slices(all_pi_names, all_si_names, group_by_container):
                slice_pi = sl["pi_names"]
                slice_si = sl["si_names"]
                sub_jid = journey_id + sl["suffix"]
                slice_display = (
                    display_name if not sl["label_suffix"]
                    else f"{display_name} · {sl['label_suffix']}"
                )

                import_container, import_bl = _collect_import_meta_bulk(slice_pi)
                export_container, export_bl, destination = _collect_export_meta_bulk(slice_si)

                si_item_data = _collect_si_item_data_bulk(
                    slice_si, item_codes, split_by_uom=split_by_uom,
                )

                if expense_side == "sales":
                    import_data = _empty_import_aggregate(display_currency)
                else:
                    import_data = _aggregate_import_costs_bulk(
                        slice_pi,
                        company_filter,
                        item_codes=item_codes,
                        target_currency=display_currency,
                        conversion_date=to_date,
                        draft_mode=draft_mode,
                    )
                if expense_side == "purchase":
                    export_data = _empty_export_aggregate()
                else:
                    export_data = _aggregate_export_costs_bulk(
                        slice_si,
                        company_filter,
                        item_codes=item_codes,
                        draft_mode=draft_mode,
                    )

                import_costs = import_data["item_costs"]
                import_item_names = import_data["item_names"]
                import_dates = import_data["posting_dates"]
                lcv_currency = import_data.get("target_currency") or display_currency
                
                export_costs = export_data["item_costs"]
                export_item_names = export_data["item_names"]
                export_dates = export_data["posting_dates"]

                if company_filter:
                    company_currency = _get_company_currency(company_filter)
                elif lcv_currency:
                    company_currency = lcv_currency
                else:
                    company_currency = "USD"

                all_item_names = {**export_item_names, **import_item_names}
                unknown_codes = [
                    ic for ic in (set(import_costs.keys()) | set(export_costs.keys()))
                    if ic not in all_item_names
                ]
                if unknown_codes:
                    all_item_names.update(_bulk_item_names(unknown_codes))

                all_dates    = import_dates + export_dates
                transit_no   = _collect_transit_display(slice_pi, slice_si, transit_company_arg)
                transit_docs = _collect_transit_invoices_structured(slice_pi, slice_si, transit_company_arg)

                imp_lines_conv = _convert_distribution_lines(
                    _distribution_lines_for_api(import_data.get("distribution_lines", [])),
                    display_currency,
                    company_currency,
                    to_date,
                )
                exp_lines_conv = _convert_distribution_lines(
                    _distribution_lines_for_api(export_data.get("distribution_lines", [])),
                    display_currency,
                    "USD",
                    to_date,
                )

                sum_imp_all = flt(import_data.get("total_charges", 0), 2)
                sum_exp_all = flt(export_data.get("total_charges", 0), 2)

                journeys_meta[sub_jid] = {
                    "transit_invoices":          transit_docs,
                    "import_item_charges_total": _cv_amt(sum_imp_all, company_currency),
                    "import_distribution_lines": imp_lines_conv,
                    "export_item_charges_total": _cv_amt(sum_exp_all, "USD"),
                    "export_distribution_lines": exp_lines_conv,
                    "container_bucket":          sl["label_suffix"] or None,
                }

                journey_rows = _build_journey_rows(
                    journey_id=sub_jid,
                    display_name=slice_display,
                    pi_names=slice_pi,
                    si_names=slice_si,
                    import_data=import_data,
                    export_data=export_data,
                    all_item_names=all_item_names,
                    si_item_data=si_item_data,
                    transit_no=transit_no,
                    import_container=import_container,
                    import_bl=import_bl,
                    export_container=export_container,
                    export_bl=export_bl,
                    destination=destination,
                    posting_dates=all_dates,
                    company_currency=company_currency,
                    export_currency="USD",
                    display_currency=display_currency or None,
                    conversion_date=to_date,
                    split_by_uom=split_by_uom,
                    expense_side=expense_side,
                )

                for row in journey_rows:
                    totals["total_additional_costs"] += row.get("additional_costs") or 0
                    totals["total_export_expenses"] += row.get("export_expenses") or 0
                    totals["grand_total"] += row.get("total") or 0

                entries.extend(journey_rows)

        return {
            "success":          True,
            "entries":          entries,
            "totals":           {k: flt(v, 2) for k, v in totals.items()},
            "journey_breakdowns": journeys_meta,
            "filters_applied": {
                "from_date": from_date,
                "to_date":   to_date,
                "company":   company_filter,
                "company_group": company_group_filter,
                "items":     item_codes,
                "item":      item_codes[0] if len(item_codes) == 1 else "",
                "expense_side": expense_side,
                "draft_mode": draft_mode,
                "restrict_transit_to_company": restrict_transit_to_company,
                "currency":  currency_filter or "all",
                "group_by":  gb_raw if gb_raw else "default",
            },
        }

    except Exception as e:
        frappe.log_error(f"Import & Export Expense Report Error: {str(e)}")
        return {
            "success":            False,
            "error":              str(e),
            "message":            _("Failed to fetch Import & Export expense data"),
            "entries":            [],
            "totals":             {},
            "journey_breakdowns": {},
        }


@frappe.whitelist()
def get_company_groups_for_import_export_filter():
    """Distinct company_group values from export-related Purchase / Sales Invoices (if column exists)."""
    groups = set()
    try:
        if _company_group_on_purchase_invoice():
            for r in frappe.db.sql(
                """
                SELECT DISTINCT company_group AS cg FROM `tabPurchase Invoice`
                WHERE IFNULL(company_group,'') != '' AND IFNULL(custom_is_export_sale,0) = 1
                """,
                as_dict=True,
            ):
                if r.get("cg"):
                    groups.add(r.cg)
        if _company_group_on_sales_invoice():
            for r in frappe.db.sql(
                """
                SELECT DISTINCT company_group AS cg FROM `tabSales Invoice`
                WHERE IFNULL(company_group,'') != '' AND IFNULL(custom_is_export_sale,0) = 1
                """,
                as_dict=True,
            ):
                if r.get("cg"):
                    groups.add(r.cg)
        return {
            "success": True,
            "company_groups": [{"name": g, "value": g} for g in sorted(groups)],
        }
    except Exception as e:
        frappe.log_error(f"get_company_groups_for_import_export_filter: {str(e)}")
        return {"success": False, "company_groups": [], "error": str(e)}


@frappe.whitelist()
def get_items_for_import_export_filter():
    """Distinct item codes from LCV items and Sales Shipment Cost items."""
    try:
        items = set()

        if frappe.db.table_exists("Landed Cost Item"):
            for row in frappe.db.sql(
                "SELECT DISTINCT item_code FROM `tabLanded Cost Item` "
                "WHERE item_code IS NOT NULL AND item_code != ''",
                as_dict=True,
            ):
                if row.get("item_code"):
                    items.add(row["item_code"])

        if frappe.db.table_exists("Sales Shipment Cost Item"):
            for row in frappe.db.sql(
                "SELECT DISTINCT item_code FROM `tabSales Shipment Cost Item` "
                "WHERE item_code IS NOT NULL AND item_code != ''",
                as_dict=True,
            ):
                if row.get("item_code"):
                    items.add(row["item_code"])

        return {
            "success": True,
            "items":   [{"name": i, "value": i} for i in sorted(items)],
        }
    except Exception as e:
        frappe.log_error(f"get_items_for_import_export_filter: {str(e)}")
        return {"success": False, "items": [], "error": str(e)}