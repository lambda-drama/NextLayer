# Copyright (c) Next Layer. Import & Export Expense Report API.
"""
Transit Numbers child doctype schema (on Purchase Invoice / Sales Invoice):
  parenttype    = "Purchase Invoice" or "Sales Invoice"
  parent        = invoice name (e.g. "PINV-0001")
  document_type = doctype of the LINKED invoice (e.g. "Sales Invoice")
  transit_no    = name of the LINKED invoice (e.g. "SINV-0001")

So a Purchase Invoice PINV-0001 linking to Sales Invoice SINV-0001 looks like:
  parent=PINV-0001, parenttype=Purchase Invoice,
  document_type=Sales Invoice, transit_no=SINV-0001

To find all invoices in the same journey we do BFS:
  - Forward: given (parenttype, parent) find all (document_type, transit_no) rows
  - Reverse: given a name, find all Transit Numbers rows where transit_no = that name
             → the parent of that row is the other invoice

Child table reference (Sales Shipment Cost):
  purchase_receipts → "Landed Cost Sales Invoice"
                       .receipt_document_type = "Sales Invoice"
                       .receipt_document       = SI name
  taxes             → "Shipment Cost Distribution"
                       .description, .amount
  items             → "Sales Shipment Cost Item"
                       .item_code, .applicable_charges
"""

import frappe
from frappe import _
from frappe.utils import flt
from collections import defaultdict


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
    """
    Return the default currency for a company.
    Always reads from the Company doctype — never assumes USD.
    """
    if not company_name:
        return "USD"
    return frappe.get_cached_value("Company", company_name, "default_currency") or "USD"


def _collect_transit_display(pi_names, si_names):
    """
    Return a display string of all transit_no values recorded in Transit Numbers
    rows where the linked document is an SI (from PI side) — these are the
    human-readable reference numbers the user wants to see.
    """
    if not _transit_table_exists():
        return ""
    transit_nos = []
    # From PI side: rows whose parent is a PI and document_type=Sales Invoice
    for pi_name in pi_names:
        for row in frappe.get_all(
            "Transit Numbers",
            filters={"parent": pi_name, "parenttype": "Purchase Invoice",
                     "document_type": "Sales Invoice"},
            fields=["transit_no"],
        ):
            val = row.get("transit_no") or ""
            if val and val not in transit_nos:
                transit_nos.append(val)
    # From SI side: rows whose parent is an SI and document_type=Purchase Invoice
    for si_name in si_names:
        for row in frappe.get_all(
            "Transit Numbers",
            filters={"parent": si_name, "parenttype": "Sales Invoice",
                     "document_type": "Purchase Invoice"},
            fields=["transit_no"],
        ):
            val = row.get("transit_no") or ""
            if val and val not in transit_nos:
                transit_nos.append(val)
    return ", ".join(transit_nos)


# ─────────────────────────────────────────────────────────────────────────────
# Transit journey graph traversal (BFS)
# ─────────────────────────────────────────────────────────────────────────────

def _get_transit_neighbors(doctype, name):
    if not _transit_table_exists():
        return set()

    neighbors = set()

    for row in frappe.get_all(
        "Transit Numbers",
        filters={"parent": name, "parenttype": doctype},
        fields=["document_type", "transit_no"],
    ):
        linked_type = row.get("document_type") or ""
        linked_name = row.get("transit_no") or ""
        if linked_type and linked_name:
            neighbors.add((linked_type, linked_name))

    for row in frappe.get_all(
        "Transit Numbers",
        filters={"transit_no": name},
        fields=["parent", "parenttype"],
    ):
        parent_name = row.get("parent") or ""
        parent_type = row.get("parenttype") or ""
        if parent_name and parent_type:
            neighbors.add((parent_type, parent_name))

    return neighbors


def _get_journey_component(doctype, name):
    """BFS — return frozenset of all (doctype, name) in the same journey."""
    visited = set()
    queue   = [(doctype, name)]
    while queue:
        dt, n = queue.pop()
        key = (dt, n)
        if key in visited:
            continue
        visited.add(key)
        for neighbor in _get_transit_neighbors(dt, n):
            if neighbor not in visited:
                queue.append(neighbor)
    return frozenset(visited)


# ─────────────────────────────────────────────────────────────────────────────
# Journey grouping
# ─────────────────────────────────────────────────────────────────────────────

def _build_journey_map(from_date, to_date, company_filter):
    journey_to_pi   = defaultdict(list)
    journey_to_si   = defaultdict(list)
    journey_display = {}
    seen_components = {}

    def _get_or_create_jid(doctype, name):
        component = _get_journey_component(doctype, name)
        if component not in seen_components:
            first_dt, first_name = sorted(component)[0]
            jid = f"{first_dt}|{first_name}"
            seen_components[component] = jid
            journey_display[jid] = first_name
        return seen_components[component]

    pi_filters = [
        ["Purchase Invoice", "docstatus",             "=",       1],
        ["Purchase Invoice", "posting_date",          "between", [from_date, to_date]],
        ["Purchase Invoice", "custom_is_export_sale", "=",       1],
    ]
    if company_filter:
        pi_filters.append(["Purchase Invoice", "company", "=", company_filter])

    for row in frappe.get_all("Purchase Invoice", filters=pi_filters, fields=["name"]):
        name = row.get("name")
        if name:
            journey_to_pi[_get_or_create_jid("Purchase Invoice", name)].append(name)

    si_filters = [
        ["Sales Invoice", "docstatus",             "=",       1],
        ["Sales Invoice", "posting_date",          "between", [from_date, to_date]],
        ["Sales Invoice", "custom_is_export_sale", "=",       1],
    ]
    if company_filter:
        si_filters.append(["Sales Invoice", "company", "=", company_filter])

    for row in frappe.get_all("Sales Invoice", filters=si_filters, fields=["name"]):
        name = row.get("name")
        if name:
            journey_to_si[_get_or_create_jid("Sales Invoice", name)].append(name)

    return journey_to_pi, journey_to_si, journey_display


# ─────────────────────────────────────────────────────────────────────────────
# Container / B/L / Destination
# ─────────────────────────────────────────────────────────────────────────────

def _collect_import_meta(pi_names):
    containers, bls = [], []
    for name in pi_names:
        try:
            doc = frappe.get_doc("Purchase Invoice", name)
            containers.append(_safe_get(doc, "custom_container_no"))
            bls.append(_safe_get(doc, "custom_bill_of_landing"))
        except Exception:
            pass
    return _join_unique(containers), _join_unique(bls)


def _collect_export_meta(si_names):
    containers, bls, destinations = [], [], []
    for name in si_names:
        try:
            doc = frappe.get_doc("Sales Invoice", name)
            containers.append(_safe_get(doc, "custom_container_no"))
            bls.append(_safe_get(doc, "custom_bill_of_landing"))
            destinations.append(_safe_get(doc, "custom_destination"))
        except Exception:
            pass
    return _join_unique(containers), _join_unique(bls), _join_unique(destinations)


# ─────────────────────────────────────────────────────────────────────────────
# Units / Price / Total Value — from Sales Invoice item rows
# ─────────────────────────────────────────────────────────────────────────────

def _collect_si_item_data(si_names, item_filter):
    item_data = {}
    for si_name in si_names:
        try:
            si_doc = frappe.get_doc("Sales Invoice", si_name)
            transaction_currency = si_doc.get("currency") or "USD"
            company_currency     = _get_company_currency(si_doc.get("company"))

            for row in si_doc.get("items") or []:
                ic = row.get("item_code") or ""
                if not ic or (item_filter and ic != item_filter):
                    continue
                if ic not in item_data:
                    item_data[ic] = {
                        "units":                0.0,
                        "price":                0.0,
                        "total_value":          0.0,
                        "transaction_currency": transaction_currency,
                        "company_currency":     company_currency,
                    }
                item_data[ic]["units"]       += flt(row.get("qty"),    2)
                item_data[ic]["price"]        = flt(row.get("rate"),   2)
                item_data[ic]["total_value"] += flt(row.get("amount"), 2)
        except Exception:
            pass
    return item_data


# ─────────────────────────────────────────────────────────────────────────────
# Import cost aggregation — Landed Cost Vouchers
#
# NOTE: We do NOT filter LCVs by posting_date here.
# The date range is used to discover journeys (via PI/SI posting dates).
# Once we have the journey's PI list, we want ALL LCVs ever linked to those
# PIs regardless of when the LCV was posted — otherwise costs posted in a
# different accounting period than the PI are silently dropped.
# ─────────────────────────────────────────────────────────────────────────────

def _aggregate_import_costs(
    pi_names, company_filter, currency_filter, item_filter
):
    """
    Sum LCV applicable_charges per item_code for LCVs linked to this journey's PIs.
    Returns: item_costs, item_names, posting_dates, company_currency
    """
    item_costs    = defaultdict(float)
    item_names    = {}
    posting_dates = []
    # company_currency starts as None; we populate it from the first matching LCV
    company_currency = None

    if not pi_names:
        return item_costs, item_names, posting_dates, company_currency

    pi_set = set(pi_names)

    # No date filter on LCVs — we filter by company only, then match by PI linkage
    lcv_filters = [["Landed Cost Voucher", "docstatus", "=", 1]]
    if company_filter:
        lcv_filters.append(["Landed Cost Voucher", "company", "=", company_filter])

    for lcv_row in frappe.get_all(
        "Landed Cost Voucher",
        filters=lcv_filters,
        fields=["name", "company", "posting_date"],
        order_by="posting_date asc",
    ):
        lcv_name    = lcv_row.get("name")
        lcv_company = lcv_row.get("company") or ""
        lcv_currency = _get_company_currency(lcv_company)

        if currency_filter and currency_filter != "all" and lcv_currency != currency_filter:
            continue

        try:
            lcv_doc = frappe.get_doc("Landed Cost Voucher", lcv_name)
        except Exception:
            continue

        linked_pis = {
            pr.get("receipt_document")
            for pr in (lcv_doc.get("purchase_receipts") or [])
            if pr.get("receipt_document_type") == "Purchase Invoice"
            and pr.get("receipt_document")
        }
        if not (linked_pis & pi_set):
            continue

        # Capture currency from the first matching LCV
        if company_currency is None:
            company_currency = lcv_currency

        posting_dates.append(str(lcv_row.get("posting_date") or ""))

        for item_row in lcv_doc.get("items") or []:
            ic = item_row.get("item_code") or ""
            if not ic or (item_filter and ic != item_filter):
                continue
            item_costs[ic] += flt(item_row.get("applicable_charges"), 2)
            if ic not in item_names:
                item_names[ic] = (
                    item_row.get("description")
                    or frappe.get_cached_value("Item", ic, "item_name")
                    or ic
                )

    return item_costs, item_names, posting_dates, company_currency


# ─────────────────────────────────────────────────────────────────────────────
# Export cost aggregation — Sales Shipment Costs
#
# NOTE: Same reasoning as LCVs above — we do NOT filter SSCs by posting_date.
# The date range already scoped which journeys we care about via SI posting
# dates. Once we have the SI list, we collect ALL SSCs that link to them.
# ─────────────────────────────────────────────────────────────────────────────

def _aggregate_export_costs(
    si_names, company_filter, currency_filter, item_filter
):
    item_costs    = defaultdict(float)
    item_names    = {}
    posting_dates = []

    freight               = 0.0
    storage               = 0.0
    export_charges_doonta = 0.0

    # company_currency starts as None; populated from the first matching SSC
    ssc_company_currency = None

    if not si_names or not frappe.db.table_exists("Sales Shipment Cost"):
        return (
            item_costs, item_names, posting_dates,
            freight, storage, export_charges_doonta,
            ssc_company_currency,
        )

    si_set = set(si_names)

    # No date filter on SSCs — filter by company only, then match by SI linkage
    ssc_filters = [["Sales Shipment Cost", "docstatus", "=", 1]]
    if company_filter:
        ssc_filters.append(["Sales Shipment Cost", "company", "=", company_filter])

    for ssc_row in frappe.get_all(
        "Sales Shipment Cost",
        filters=ssc_filters,
        fields=["name", "posting_date"],
        order_by="posting_date asc",
    ):
        try:
            ssc_doc = frappe.get_doc("Sales Shipment Cost", ssc_row.name)
        except Exception:
            continue

        linked_sis = {
            r.get("receipt_document")
            for r in (ssc_doc.get("purchase_receipts") or [])
            if r.get("receipt_document_type") == "Sales Invoice"
            and r.get("receipt_document")
        }
        if not (linked_sis & si_set):
            continue

        ssc_currency = _get_company_currency(ssc_doc.company)

        if currency_filter and currency_filter != "all" and ssc_currency != currency_filter:
            continue

        # Capture currency from the first matching SSC
        if ssc_company_currency is None:
            ssc_company_currency = ssc_currency

        posting_dates.append(str(ssc_doc.posting_date or ""))

        for tax in (ssc_doc.get("taxes") or []):
            desc = (tax.get("description") or "").lower()
            amt  = flt(tax.get("amount"), 2)

            if "freight" in desc:
                freight               += amt
            elif "storage" in desc:
                storage               += amt
            elif "doonta" in desc:
                export_charges_doonta += amt

        for item_row in (ssc_doc.get("items") or []):
            ic = item_row.get("item_code") or ""
            if not ic or (item_filter and ic != item_filter):
                continue
            item_costs[ic] += flt(item_row.get("applicable_charges"), 2)
            if ic not in item_names:
                item_names[ic] = (
                    item_row.get("description")
                    or frappe.get_cached_value("Item", ic, "item_name")
                    or ic
                )

    return (
        item_costs, item_names, posting_dates,
        freight, storage, export_charges_doonta,
        ssc_company_currency,
    )


# ─────────────────────────────────────────────────────────────────────────────
# Row building — one row per (journey, item)
# ─────────────────────────────────────────────────────────────────────────────

def _fmt_dates(dates):
    return ", ".join(filter(None, sorted(set(dates))))[:100]


def _build_journey_rows(
    journey_id, display_name, pi_names, si_names,
    import_item_costs, export_item_costs, all_item_names,
    si_item_data, transit_no,
    import_container, import_bl,
    export_container, export_bl, destination,
    freight, storage, export_charges_doonta,
    posting_dates, company_currency,
):
    rows = []
    source = (
        "both"   if (pi_names and si_names) else
        "import" if pi_names else
        "export"
    )
    date_str       = _fmt_dates(posting_dates)
    all_item_codes = sorted(set(import_item_costs.keys()) | set(export_item_costs.keys()))

    journey_level = {
        "freight":               freight,
        "storage":               storage,
        "export_charges_doonta": export_charges_doonta,
    }

    if not all_item_codes:
        jl_total = sum(journey_level.values())
        if jl_total:
            rows.append({
                "journey_id":            journey_id,
                "transit_display":       display_name,
                "transit_no":            transit_no,
                "item_code":             "",
                "item_name":             "",
                "description":           "",
                "units":                 None,
                "price":                 None,
                "total_value":           None,
                "transaction_currency":  company_currency,
                "posting_date":          date_str,
                "import_container":      import_container or "—",
                "export_container":      export_container or "—",
                "import_bl":             import_bl        or "—",
                "export_bl":             export_bl        or "—",
                "destination":           destination      or "—",
                "freight":               freight  or None,
                "storage":               storage  or None,
                "export_charges_doonta": export_charges_doonta or None,
                "additional_costs":      None,
                "export_charges":        None,
                "total":                 jl_total,
                "company_currency":      company_currency,
                "source":                source,
            })
        return rows

    for idx, item_code in enumerate(all_item_codes):
        is_first    = idx == 0
        add_costs   = flt(import_item_costs.get(item_code, 0), 2)
        exp_charges = flt(export_item_costs.get(item_code, 0), 2)
        si_meta     = si_item_data.get(item_code, {})

        jl     = {k: (v or None) if is_first else None for k, v in journey_level.items()}
        jl_sum = sum(journey_level.values()) if is_first else 0.0
        total  = add_costs + exp_charges + jl_sum

        desc = (
            all_item_names.get(item_code)
            or frappe.get_cached_value("Item", item_code, "item_name")
            or item_code
        )

        transaction_currency = si_meta.get("transaction_currency") or company_currency

        rows.append({
            "journey_id":            journey_id,
            "transit_display":       display_name,
            "transit_no":            transit_no,
            "item_code":             item_code,
            "item_name":             item_code,
            "description":           desc,
            "units":                 si_meta.get("units")       or None,
            "price":                 si_meta.get("price")       or None,
            "total_value":           si_meta.get("total_value") or None,
            "transaction_currency":  transaction_currency,
            "posting_date":          date_str,
            "import_container":      import_container or "—",
            "export_container":      export_container or "—",
            "import_bl":             import_bl        or "—",
            "export_bl":             export_bl        or "—",
            "destination":           destination      or "—",
            "freight":               jl["freight"],
            "storage":               jl["storage"],
            "export_charges_doonta": jl["export_charges_doonta"],
            "additional_costs":      add_costs   or None,
            "export_charges":        exp_charges or None,
            "total":                 total,
            "company_currency":      company_currency,
            "source":                source,
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

        company_filter  = filters.get("company")  or ""
        item_filter     = filters.get("item")      or ""
        currency_filter = filters.get("currency")  or ""

        journey_to_pi, journey_to_si, journey_display = _build_journey_map(
            from_date, to_date, company_filter
        )
        all_journey_ids = sorted(set(journey_to_pi.keys()) | set(journey_to_si.keys()))

        entries = []
        totals  = defaultdict(float)

        for journey_id in all_journey_ids:
            pi_names     = list(set(journey_to_pi.get(journey_id, [])))
            si_names     = list(set(journey_to_si.get(journey_id, [])))
            display_name = journey_display.get(journey_id, journey_id.replace("|", " "))

            import_container, import_bl              = _collect_import_meta(pi_names)
            export_container, export_bl, destination = _collect_export_meta(si_names)
            si_item_data                             = _collect_si_item_data(si_names, item_filter)

            # ── Import costs (LCVs) ──────────────────────────────────────────
            # Note: no date filter on LCVs — we find all LCVs ever linked to
            # this journey's PIs so costs posted in a different period are
            # never silently dropped.
            import_costs, import_item_names, import_dates, lcv_currency = \
                _aggregate_import_costs(pi_names, company_filter, currency_filter, item_filter)

            # ── Export costs (SSCs) ──────────────────────────────────────────
            # Same reasoning — no date filter on SSCs.
            (
                export_costs, export_item_names, export_dates,
                freight, storage, export_charges_doonta,
                ssc_currency,
            ) = _aggregate_export_costs(si_names, company_filter, currency_filter, item_filter)

            # ── Company currency resolution ──────────────────────────────────
            # Priority:
            #   1. Explicitly filtered company → always authoritative
            #   2. Currency returned by LCV aggregation (first matching LCV)
            #   3. Currency returned by SSC aggregation (first matching SSC)
            #   4. Fall back to company filter default, else "USD"
            if company_filter:
                company_currency = _get_company_currency(company_filter)
            elif lcv_currency is not None:
                company_currency = lcv_currency
            elif ssc_currency is not None:
                company_currency = ssc_currency
            else:
                company_currency = "USD"

            all_item_names = {**export_item_names, **import_item_names}
            all_dates      = import_dates + export_dates

            transit_no = _collect_transit_display(pi_names, si_names)

            journey_rows = _build_journey_rows(
                journey_id=journey_id, display_name=display_name,
                pi_names=pi_names,     si_names=si_names,
                import_item_costs=import_costs,
                export_item_costs=export_costs,
                all_item_names=all_item_names,
                si_item_data=si_item_data,
                transit_no=transit_no,
                import_container=import_container, import_bl=import_bl,
                export_container=export_container, export_bl=export_bl,
                destination=destination,
                freight=freight, storage=storage,
                export_charges_doonta=export_charges_doonta,
                posting_dates=all_dates, company_currency=company_currency,
            )

            for row in journey_rows:
                totals["total_additional_costs"]      += row.get("additional_costs")      or 0
                totals["total_export_charges_doonta"]  += row.get("export_charges_doonta") or 0
                totals["total_export_charges"]         += row.get("export_charges")        or 0
                totals["total_freight"]                += row.get("freight")               or 0
                totals["total_storage"]                += row.get("storage")               or 0
                totals["grand_total"]                  += row.get("total")                 or 0

            entries.extend(journey_rows)

        return {
            "success": True,
            "entries": entries,
            "totals":  {k: flt(v, 2) for k, v in totals.items()},
            "filters_applied": {
                "from_date": from_date,
                "to_date":   to_date,
                "company":   company_filter,
                "item":      item_filter,
                "currency":  currency_filter or "all",
            },
        }

    except Exception as e:
        frappe.log_error(f"Import & Export Expense Report Error: {str(e)}")
        return {
            "success": False,
            "error":   str(e),
            "message": _("Failed to fetch Import & Export expense data"),
            "entries": [],
            "totals":  {},
        }


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