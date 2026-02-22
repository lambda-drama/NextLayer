# Copyright (c) Next Layer. Import & Export Expense Report API.
"""
API for Import & Export Expense Report.

Business context:
  - Intercompany trading: supplier → company → internal customer
  - Same journey tracked via Transit Numbers (child doctype linking invoices)
  - Import side : Purchase Invoices (custom_is_export_sale=1) + Landed Cost Vouchers
  - Export side : Sales Invoices   (custom_is_export_sale=1) + Sales Shipment Costs

Excel column order (22 cols — Excel 21 + transit_no for tracking):
  S NO. | Description | Item | Units | Price | Total Value |
  Import Container | Export Container | Import B/L | Export B/L | Destination |
  Transit No. |
  Freight & Storage |
  Export Charges Doonta |
  [Import Charges]  → Joint Line | Harvinder |
  Jebel Ali Expenses |
  [Export Charges]  → Joint Line | Harvinder |
  Export Transportation | ECTN | Total

Row granularity: one row per (journey, item).
  · additional_costs      = LCV applicable_charges  (Import Charges – Joint Line)
  · import_havinder       = placeholder (future)
  · export_charges_doonta = SSC "doonta" charges    (single col)
  · export_charges        = SSC applicable_charges  (Export Charges – Joint Line)
  · export_havinder       = placeholder (future)
  · jebel_ali             = SSC / LCV jebel ali charges
  · export_transportation = SSC transportation charges
  · ectn                  = ECTN charges
  · freight + storage     = SSC tax rows (journey-level, first item row only)
  · units / price / total_value come from SI item rows using BASE fields
    (base_rate, base_amount) so values are always in company currency
  · currency is always the company default currency (never transaction currency)
"""

import frappe
from frappe import _
from frappe.utils import flt
from collections import defaultdict


# ─────────────────────────────────────────────────────────────────────────────
# Utility helpers
# ─────────────────────────────────────────────────────────────────────────────

def _safe_get(doc, fieldname, default=""):
    """Return doc.fieldname safely, falling back to default."""
    if doc is None:
        return default
    val = doc.get(fieldname)
    return val if val is not None and val != "" else default


def _transit_table_exists():
    return frappe.db.table_exists("Transit Numbers")


def _join_unique(values):
    """Deduplicate and join non-empty strings with ', '."""
    seen = []
    for v in values:
        if v and v not in seen:
            seen.append(v)
    return ", ".join(seen)


def _collect_transit_numbers(pi_names, si_names):
    """
    Return a joined string of all transit_no values recorded against any
    PI or SI in this journey (from the Transit Numbers child table).
    This gives the user a concrete reference number visible in the report.
    """
    if not _transit_table_exists():
        return ""
    transit_nos = []
    all_names = [(n, "Purchase Invoice") for n in pi_names] + \
                [(n, "Sales Invoice")    for n in si_names]
    for doc_name, doctype in all_names:
        for row in frappe.get_all(
            "Transit Numbers",
            filters={"parent": doc_name, "parenttype": doctype},
            fields=["transit_no"],
        ):
            val = row.get("transit_no") or ""
            if val and val not in transit_nos:
                transit_nos.append(val)
    return ", ".join(transit_nos)


# ─────────────────────────────────────────────────────────────────────────────
# Transit journey graph traversal
# ─────────────────────────────────────────────────────────────────────────────

def _get_transit_neighbors(doctype, name):
    """
    Return all (doctype, name) pairs directly linked to this invoice
    via the Transit Numbers child table — bidirectional.
    """
    if not _transit_table_exists():
        return set()

    neighbors = set()

    # This invoice is the parent → linked invoice is (document_type, transit_no)
    for row in frappe.get_all(
        "Transit Numbers",
        filters={"parent": name, "parenttype": doctype},
        fields=["document_type", "transit_no"],
    ):
        if row.get("transit_no") and row.get("document_type"):
            neighbors.add((row["document_type"], row["transit_no"]))

    # This invoice appears as transit_no → the parent is the other invoice
    for row in frappe.get_all(
        "Transit Numbers",
        filters={"transit_no": name, "document_type": doctype},
        fields=["parent", "parenttype"],
    ):
        if row.get("parent") and row.get("parenttype"):
            neighbors.add((row["parenttype"], row["parent"]))

    return neighbors


def _get_journey_component(doctype, name):
    """
    BFS — return frozenset of all (doctype, name) in the same transit journey.
    """
    visited = set()
    queue = [(doctype, name)]
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
    """
    Fetch all qualifying PIs and SIs, group by transit connected component.

    Returns:
        journey_to_pi:   dict[journey_id → list[pi_name]]
        journey_to_si:   dict[journey_id → list[si_name]]
        journey_display: dict[journey_id → display_label]
    """
    journey_to_pi = defaultdict(list)
    journey_to_si = defaultdict(list)
    journey_display = {}
    seen_components = {}   # frozenset(component) → journey_id

    def _get_or_create_jid(doctype, name):
        component = _get_journey_component(doctype, name)
        if component not in seen_components:
            first_dt, first_name = sorted(component)[0]
            jid = f"{first_dt}|{first_name}"
            seen_components[component] = jid
            journey_display[jid] = first_name
        return seen_components[component]

    # Purchase Invoices (import)
    pi_filters = [
        ["Purchase Invoice", "docstatus", "=", 1],
        ["Purchase Invoice", "posting_date", "between", [from_date, to_date]],
        ["Purchase Invoice", "custom_is_export_sale", "=", 1],
    ]
    if company_filter:
        pi_filters.append(["Purchase Invoice", "company", "=", company_filter])

    for row in frappe.get_all("Purchase Invoice", filters=pi_filters, fields=["name"]):
        name = row.get("name")
        if name:
            journey_to_pi[_get_or_create_jid("Purchase Invoice", name)].append(name)

    # Sales Invoices (export)
    si_filters = [
        ["Sales Invoice", "docstatus", "=", 1],
        ["Sales Invoice", "posting_date", "between", [from_date, to_date]],
        ["Sales Invoice", "custom_is_export_sale", "=", 1],
    ]
    if company_filter:
        si_filters.append(["Sales Invoice", "company", "=", company_filter])

    for row in frappe.get_all("Sales Invoice", filters=si_filters, fields=["name"]):
        name = row.get("name")
        if name:
            journey_to_si[_get_or_create_jid("Sales Invoice", name)].append(name)

    return journey_to_pi, journey_to_si, journey_display


# ─────────────────────────────────────────────────────────────────────────────
# Container / B/L / Destination — fetched directly from PI and SI
# ─────────────────────────────────────────────────────────────────────────────

def _collect_import_meta(pi_names):
    """
    Return (import_container, import_bl) collected from all Purchase Invoices.
    """
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
    """
    Return (export_container, export_bl, destination) collected from all Sales Invoices.
    """
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
    """
    Return dict[item_code → {units, price, total_value, transaction_currency, company_currency}]

    Price and Total Value use TRANSACTION currency fields (rate, amount) — this is
    typically USD and is the real commercial value agreed with the customer.

    Both currencies are returned so the UI can format each column correctly:
      - transaction_currency → price, total_value columns
      - company_currency     → distribution charge columns (LCV / SSC)
    """
    item_data = {}
    for si_name in si_names:
        try:
            si_doc = frappe.get_doc("Sales Invoice", si_name)
            transaction_currency = si_doc.get("currency") or "USD"
            company_currency = (
                frappe.get_cached_value("Company", si_doc.get("company"), "default_currency")
                or "USD"
            ) if si_doc.get("company") else "USD"

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
                item_data[ic]["units"]       += flt(row.get("qty"), 2)
                item_data[ic]["price"]        = flt(row.get("rate"),   2)   # transaction currency
                item_data[ic]["total_value"] += flt(row.get("amount"), 2)   # transaction currency
        except Exception:
            pass
    return item_data


# ─────────────────────────────────────────────────────────────────────────────
# Import cost aggregation — Landed Cost Vouchers
# ─────────────────────────────────────────────────────────────────────────────

def _aggregate_import_costs(pi_names, from_date, to_date, company_filter, currency_filter, item_filter):
    """
    Sum LCV applicable_charges per item_code for all LCVs linked to this journey.

    Returns:
        item_costs:    dict[item_code → additional_costs]
        item_names:    dict[item_code → description]
        posting_dates: list[str]
        currency:      str
    """
    item_costs = defaultdict(float)
    item_names = {}
    posting_dates = []
    currency = "USD"

    if not pi_names:
        return item_costs, item_names, posting_dates, currency

    pi_set = set(pi_names)

    lcv_filters = [
        ["Landed Cost Voucher", "docstatus", "=", 1],
        ["Landed Cost Voucher", "posting_date", "between", [from_date, to_date]],
    ]
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
        # Use company default currency (never transaction currency)
        currency = (
            frappe.get_cached_value("Company", lcv_company, "default_currency") or "USD"
        )
        if currency_filter and currency_filter != "all" and currency != currency_filter:
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

    return item_costs, item_names, posting_dates, currency


# ─────────────────────────────────────────────────────────────────────────────
# Export cost aggregation — Sales Shipment Costs
# ─────────────────────────────────────────────────────────────────────────────

# Copyright (c) Next Layer. Import & Export Expense Report API.
"""
API for Import & Export Expense Report.

Business context:
  - Intercompany trading: supplier → company → internal customer
  - Same journey tracked via Transit Numbers (child doctype linking invoices)
  - Import side : Purchase Invoices (custom_is_export_sale=1) + Landed Cost Vouchers
  - Export side : Sales Invoices   (custom_is_export_sale=1) + Sales Shipment Costs

Excel column order (22 cols — Excel 21 + transit_no for tracking):
  S NO. | Description | Item | Units | Price | Total Value |
  Import Container | Export Container | Import B/L | Export B/L | Destination |
  Transit No. |
  Freight & Storage |
  Export Charges Doonta |
  [Import Charges]  → Joint Line | Harvinder |
  Jebel Ali Expenses |
  [Export Charges]  → Joint Line | Harvinder |
  Export Transportation | ECTN | Total

Row granularity: one row per (journey, item).
  · additional_costs      = LCV applicable_charges  (Import Charges – Joint Line)
  · import_havinder       = placeholder (future)
  · export_charges_doonta = SSC "doonta" charges    (single col)
  · export_charges        = SSC applicable_charges  (Export Charges – Joint Line)
  · export_havinder       = placeholder (future)
  · jebel_ali             = SSC / LCV jebel ali charges
  · export_transportation = SSC transportation charges
  · ectn                  = ECTN charges
  · freight + storage     = SSC tax rows (journey-level, first item row only)
  · units / price / total_value come from SI item rows using BASE fields
    (base_rate, base_amount) so values are always in company currency
  · currency is always the company default currency (never transaction currency)
"""

import frappe
from frappe import _
from frappe.utils import flt
from collections import defaultdict


# ─────────────────────────────────────────────────────────────────────────────
# Utility helpers
# ─────────────────────────────────────────────────────────────────────────────

def _safe_get(doc, fieldname, default=""):
    """Return doc.fieldname safely, falling back to default."""
    if doc is None:
        return default
    val = doc.get(fieldname)
    return val if val is not None and val != "" else default


def _transit_table_exists():
    return frappe.db.table_exists("Transit Numbers")


def _join_unique(values):
    """Deduplicate and join non-empty strings with ', '."""
    seen = []
    for v in values:
        if v and v not in seen:
            seen.append(v)
    return ", ".join(seen)


def _collect_transit_numbers(pi_names, si_names):
    """
    Return a joined string of all transit_no values recorded against any
    PI or SI in this journey (from the Transit Numbers child table).
    This gives the user a concrete reference number visible in the report.
    """
    if not _transit_table_exists():
        return ""
    transit_nos = []
    all_names = [(n, "Purchase Invoice") for n in pi_names] + \
                [(n, "Sales Invoice")    for n in si_names]
    for doc_name, doctype in all_names:
        for row in frappe.get_all(
            "Transit Numbers",
            filters={"parent": doc_name, "parenttype": doctype},
            fields=["transit_no"],
        ):
            val = row.get("transit_no") or ""
            if val and val not in transit_nos:
                transit_nos.append(val)
    return ", ".join(transit_nos)


# ─────────────────────────────────────────────────────────────────────────────
# Transit journey graph traversal
# ─────────────────────────────────────────────────────────────────────────────

def _get_transit_neighbors(doctype, name):
    """
    Return all (doctype, name) pairs directly linked to this invoice
    via the Transit Numbers child table — bidirectional.
    """
    if not _transit_table_exists():
        return set()

    neighbors = set()

    # This invoice is the parent → linked invoice is (document_type, transit_no)
    for row in frappe.get_all(
        "Transit Numbers",
        filters={"parent": name, "parenttype": doctype},
        fields=["document_type", "transit_no"],
    ):
        if row.get("transit_no") and row.get("document_type"):
            neighbors.add((row["document_type"], row["transit_no"]))

    # This invoice appears as transit_no → the parent is the other invoice
    for row in frappe.get_all(
        "Transit Numbers",
        filters={"transit_no": name, "document_type": doctype},
        fields=["parent", "parenttype"],
    ):
        if row.get("parent") and row.get("parenttype"):
            neighbors.add((row["parenttype"], row["parent"]))

    return neighbors


def _get_journey_component(doctype, name):
    """
    BFS — return frozenset of all (doctype, name) in the same transit journey.
    """
    visited = set()
    queue = [(doctype, name)]
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
    """
    Fetch all qualifying PIs and SIs, group by transit connected component.

    Returns:
        journey_to_pi:   dict[journey_id → list[pi_name]]
        journey_to_si:   dict[journey_id → list[si_name]]
        journey_display: dict[journey_id → display_label]
    """
    journey_to_pi = defaultdict(list)
    journey_to_si = defaultdict(list)
    journey_display = {}
    seen_components = {}   # frozenset(component) → journey_id

    def _get_or_create_jid(doctype, name):
        component = _get_journey_component(doctype, name)
        if component not in seen_components:
            first_dt, first_name = sorted(component)[0]
            jid = f"{first_dt}|{first_name}"
            seen_components[component] = jid
            journey_display[jid] = first_name
        return seen_components[component]

    # Purchase Invoices (import)
    pi_filters = [
        ["Purchase Invoice", "docstatus", "=", 1],
        ["Purchase Invoice", "posting_date", "between", [from_date, to_date]],
        ["Purchase Invoice", "custom_is_export_sale", "=", 1],
    ]
    if company_filter:
        pi_filters.append(["Purchase Invoice", "company", "=", company_filter])

    for row in frappe.get_all("Purchase Invoice", filters=pi_filters, fields=["name"]):
        name = row.get("name")
        if name:
            journey_to_pi[_get_or_create_jid("Purchase Invoice", name)].append(name)

    # Sales Invoices (export)
    si_filters = [
        ["Sales Invoice", "docstatus", "=", 1],
        ["Sales Invoice", "posting_date", "between", [from_date, to_date]],
        ["Sales Invoice", "custom_is_export_sale", "=", 1],
    ]
    if company_filter:
        si_filters.append(["Sales Invoice", "company", "=", company_filter])

    for row in frappe.get_all("Sales Invoice", filters=si_filters, fields=["name"]):
        name = row.get("name")
        if name:
            journey_to_si[_get_or_create_jid("Sales Invoice", name)].append(name)

    return journey_to_pi, journey_to_si, journey_display


# ─────────────────────────────────────────────────────────────────────────────
# Container / B/L / Destination — fetched directly from PI and SI
# ─────────────────────────────────────────────────────────────────────────────

def _collect_import_meta(pi_names):
    """
    Return (import_container, import_bl) collected from all Purchase Invoices.
    """
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
    """
    Return (export_container, export_bl, destination) collected from all Sales Invoices.
    """
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
    """
    Return dict[item_code → {units, price, total_value, transaction_currency, company_currency}]

    Price and Total Value use TRANSACTION currency fields (rate, amount) — this is
    typically USD and is the real commercial value agreed with the customer.

    Both currencies are returned so the UI can format each column correctly:
      - transaction_currency → price, total_value columns
      - company_currency     → distribution charge columns (LCV / SSC)
    """
    item_data = {}
    for si_name in si_names:
        try:
            si_doc = frappe.get_doc("Sales Invoice", si_name)
            transaction_currency = si_doc.get("currency") or "USD"
            company_currency = (
                frappe.get_cached_value("Company", si_doc.get("company"), "default_currency")
                or "USD"
            ) if si_doc.get("company") else "USD"

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
                item_data[ic]["units"]       += flt(row.get("qty"), 2)
                item_data[ic]["price"]        = flt(row.get("rate"),   2)   # transaction currency
                item_data[ic]["total_value"] += flt(row.get("amount"), 2)   # transaction currency
        except Exception:
            pass
    return item_data


# ─────────────────────────────────────────────────────────────────────────────
# Import cost aggregation — Landed Cost Vouchers
# ─────────────────────────────────────────────────────────────────────────────

def _aggregate_import_costs(pi_names, from_date, to_date, company_filter, currency_filter, item_filter):
    """
    Sum LCV applicable_charges per item_code for all LCVs linked to this journey.

    Returns:
        item_costs:    dict[item_code → additional_costs]
        item_names:    dict[item_code → description]
        posting_dates: list[str]
        currency:      str
    """
    item_costs = defaultdict(float)
    item_names = {}
    posting_dates = []
    currency = "USD"

    if not pi_names:
        return item_costs, item_names, posting_dates, currency

    pi_set = set(pi_names)

    lcv_filters = [
        ["Landed Cost Voucher", "docstatus", "=", 1],
        ["Landed Cost Voucher", "posting_date", "between", [from_date, to_date]],
    ]
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
        # Use company default currency (never transaction currency)
        currency = (
            frappe.get_cached_value("Company", lcv_company, "default_currency") or "USD"
        )
        if currency_filter and currency_filter != "all" and currency != currency_filter:
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

    return item_costs, item_names, posting_dates, currency


# ─────────────────────────────────────────────────────────────────────────────
# Export cost aggregation — Sales Shipment Costs
# ─────────────────────────────────────────────────────────────────────────────

def _aggregate_export_costs(si_names, from_date, to_date, company_filter, currency_filter, item_filter):
    """
    Aggregate all SSC data for this journey.
    """

    item_costs = defaultdict(float)
    item_names = {}
    posting_dates = []

    freight = 0.0
    storage = 0.0
    export_charges_doonta = 0.0
    jebel_ali = 0.0
    export_transportation = 0.0
    ectn = 0.0

    if not si_names or not frappe.db.table_exists("Sales Shipment Cost"):
        return (
            item_costs, item_names, posting_dates,
            freight, storage, export_charges_doonta,
            jebel_ali, export_transportation, ectn,
            "USD",
        )

    si_set = set(si_names)
    ssc_company_currency = "USD"

    ssc_filters = [
        ["Sales Shipment Cost", "docstatus", "=", 1],
        ["Sales Shipment Cost", "posting_date", "between", [from_date, to_date]],
    ]

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

        # check linked invoices
        linked_sis = {
            r.get("receipt_document")
            for r in (ssc_doc.get("purchase_receipts") or [])
            if r.get("receipt_document_type") == "Sales Invoice"
        }

        if not (linked_sis & si_set):
            continue

        # resolve company currency
        if ssc_doc.company:
            ssc_company_currency = (
                frappe.get_cached_value("Company", ssc_doc.company, "default_currency")
                or "USD"
            )

        if currency_filter and currency_filter != "all" \
           and ssc_company_currency != currency_filter:
            continue

        posting_dates.append(str(ssc_doc.posting_date or ""))

        # ✅ FIXED — iterate taxes properly
        for tax in (ssc_doc.get("taxes") or []):
            desc = (tax.get("description") or "").lower()
            amt = flt(tax.get("amount"), 2)

            if "freight" in desc:
                freight += amt
            elif "storage" in desc:
                storage += amt
            elif "doonta" in desc:
                export_charges_doonta += amt
            elif "jebel" in desc:
                jebel_ali += amt
            elif "transport" in desc:
                export_transportation += amt
            elif "ectn" in desc:
                ectn += amt

        # item-level charges
        for item_row in (ssc_doc.get("items") or []):
            ic = item_row.get("item_code")
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
        jebel_ali, export_transportation, ectn,
        ssc_company_currency,
    )


# ─────────────────────────────────────────────────────────────────────────────
# Row building
# ─────────────────────────────────────────────────────────────────────────────

def _fmt_dates(dates):
    return ", ".join(filter(None, sorted(set(dates))))[:100]


def _build_journey_rows(
    journey_id, display_name, pi_names, si_names,
    import_item_costs, export_item_costs, all_item_names,
    si_item_data,
    transit_no,
    import_container, import_bl,
    export_container, export_bl, destination,
    freight, storage,
    export_charges_doonta, jebel_ali, export_transportation, ectn,
    posting_dates, company_currency,
):
    """
    One row per item. Journey-level costs (freight, storage, doonta, jebel,
    transport, ectn) appear only on the FIRST item row.

    Each row carries two currency fields:
      transaction_currency  — for Price and Total Value (SI transaction currency, e.g. USD)
      company_currency      — for all distribution charges (LCV / SSC, e.g. CDF, XAF)
    """
    rows = []
    source = (
        "both"   if (pi_names and si_names) else
        "import" if pi_names else
        "export"
    )
    date_str      = _fmt_dates(posting_dates)
    all_item_codes = sorted(set(import_item_costs.keys()) | set(export_item_costs.keys()))

    # Journey-level amounts (go on first item row only)
    journey_level = {
        "freight":               freight,
        "storage":               storage,
        "export_charges_doonta": export_charges_doonta,
        "jebel_ali":             jebel_ali,
        "export_transportation": export_transportation,
        "ectn":                  ectn,
    }

    if not all_item_codes:
        # No item-level data — emit one row with journey-level amounts if any exist
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
                **{k: (v or None) for k, v in journey_level.items()},
                "additional_costs":      None,
                "import_havinder":       None,
                "export_charges":        None,
                "export_havinder":       None,
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

        # Journey-level amounts only on first row
        jl = {k: (v or None) if is_first else None for k, v in journey_level.items()}
        jl_sum = sum(journey_level.values()) if is_first else 0.0

        total = add_costs + exp_charges + jl_sum

        desc = (
            all_item_names.get(item_code)
            or frappe.get_cached_value("Item", item_code, "item_name")
            or item_code
        )

        si_meta              = si_item_data.get(item_code, {})
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
            "transaction_currency":  transaction_currency,   # for Price / Total Value
            "posting_date":          date_str,
            "import_container":      import_container or "—",
            "export_container":      export_container or "—",
            "import_bl":             import_bl        or "—",
            "export_bl":             export_bl        or "—",
            "destination":           destination      or "—",
            # Journey-level (first row only)
            "freight":               jl["freight"],
            "storage":               jl["storage"],
            "export_charges_doonta": jl["export_charges_doonta"],
            "jebel_ali":             jl["jebel_ali"],
            "export_transportation": jl["export_transportation"],
            "ectn":                  jl["ectn"],
            # Item-level
            "additional_costs":      add_costs   or None,
            "import_havinder":       None,
            "export_charges":        exp_charges or None,
            "export_havinder":       None,
            "total":                 total,
            "company_currency":      company_currency,        # for all distribution charges
            "source":                source,
        })

    return rows


# ─────────────────────────────────────────────────────────────────────────────
# Public API
# ─────────────────────────────────────────────────────────────────────────────

@frappe.whitelist()
def get_import_export_expense_report(filters=None):
    """
    Main report endpoint — returns 21-column item-based rows grouped by journey.
    """
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
        totals = defaultdict(float)

        for journey_id in all_journey_ids:
            pi_names = list(set(journey_to_pi.get(journey_id, [])))
            si_names = list(set(journey_to_si.get(journey_id, [])))
            display_name = journey_display.get(journey_id, journey_id.replace("|", " "))

            # Metadata from PI / SI directly
            import_container, import_bl = _collect_import_meta(pi_names)
            export_container, export_bl, destination = _collect_export_meta(si_names)

            # Units / Price / Total Value from SI item rows
            si_item_data = _collect_si_item_data(si_names, item_filter)

            # Import costs (LCV)
            import_costs, import_item_names, import_dates, currency = _aggregate_import_costs(
                pi_names, from_date, to_date, company_filter, currency_filter, item_filter
            )

            # Export costs (SSC)
            (
                export_costs, export_item_names, export_dates,
                freight, storage, export_charges_doonta,
                jebel_ali, export_transportation, ectn,
                ssc_company_currency,
            ) = _aggregate_export_costs(
                si_names, from_date, to_date, company_filter, currency_filter, item_filter
            )

            # Company currency for distribution charges:
            # LCV gives us the import company currency; SSC gives us export.
            # Prefer LCV currency if it's not USD, otherwise use SSC's.
            company_currency = currency if currency != "USD" else ssc_company_currency

            all_item_names  = {**export_item_names, **import_item_names}
            all_dates       = import_dates + export_dates

            # Transit numbers for tracking
            transit_no = _collect_transit_numbers(pi_names, si_names)

            journey_rows = _build_journey_rows(
                journey_id=journey_id, display_name=display_name,
                pi_names=pi_names, si_names=si_names,
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
                jebel_ali=jebel_ali,
                export_transportation=export_transportation,
                ectn=ectn,
                posting_dates=all_dates, company_currency=company_currency,
            )

            for row in journey_rows:
                totals["total_additional_costs"]      += row.get("additional_costs")      or 0
                totals["total_import_havinder"]        += row.get("import_havinder")       or 0
                totals["total_export_charges_doonta"]  += row.get("export_charges_doonta") or 0
                totals["total_jebel_ali"]              += row.get("jebel_ali")             or 0
                totals["total_export_charges"]         += row.get("export_charges")        or 0
                totals["total_export_havinder"]        += row.get("export_havinder")       or 0
                totals["total_freight"]                += row.get("freight")               or 0
                totals["total_storage"]                += row.get("storage")               or 0
                totals["total_export_transportation"]  += row.get("export_transportation") or 0
                totals["total_ectn"]                   += row.get("ectn")                  or 0
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
    """Distinct item codes from LCV and SSC for the filter dropdown."""
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


# ─────────────────────────────────────────────────────────────────────────────
# Row building
# ─────────────────────────────────────────────────────────────────────────────

def _fmt_dates(dates):
    return ", ".join(filter(None, sorted(set(dates))))[:100]


def _build_journey_rows(
    journey_id, display_name, pi_names, si_names,
    import_item_costs, export_item_costs, all_item_names,
    si_item_data,
    transit_no,
    import_container, import_bl,
    export_container, export_bl, destination,
    freight, storage,
    export_charges_doonta, jebel_ali, export_transportation, ectn,
    posting_dates, company_currency,
):
    """
    One row per item. Journey-level costs (freight, storage, doonta, jebel,
    transport, ectn) appear only on the FIRST item row.

    Each row carries two currency fields:
      transaction_currency  — for Price and Total Value (SI transaction currency, e.g. USD)
      company_currency      — for all distribution charges (LCV / SSC, e.g. CDF, XAF)
    """
    rows = []
    source = (
        "both"   if (pi_names and si_names) else
        "import" if pi_names else
        "export"
    )
    date_str      = _fmt_dates(posting_dates)
    all_item_codes = sorted(set(import_item_costs.keys()) | set(export_item_costs.keys()))

    # Journey-level amounts (go on first item row only)
    journey_level = {
        "freight":               freight,
        "storage":               storage,
        "export_charges_doonta": export_charges_doonta,
        "jebel_ali":             jebel_ali,
        "export_transportation": export_transportation,
        "ectn":                  ectn,
    }

    if not all_item_codes:
        # No item-level data — emit one row with journey-level amounts if any exist
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
                **{k: (v or None) for k, v in journey_level.items()},
                "additional_costs":      None,
                "import_havinder":       None,
                "export_charges":        None,
                "export_havinder":       None,
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

        # Journey-level amounts only on first row
        jl = {k: (v or None) if is_first else None for k, v in journey_level.items()}
        jl_sum = sum(journey_level.values()) if is_first else 0.0

        total = add_costs + exp_charges + jl_sum

        desc = (
            all_item_names.get(item_code)
            or frappe.get_cached_value("Item", item_code, "item_name")
            or item_code
        )

        si_meta              = si_item_data.get(item_code, {})
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
            "transaction_currency":  transaction_currency,   # for Price / Total Value
            "posting_date":          date_str,
            "import_container":      import_container or "—",
            "export_container":      export_container or "—",
            "import_bl":             import_bl        or "—",
            "export_bl":             export_bl        or "—",
            "destination":           destination      or "—",
            # Journey-level (first row only)
            "freight":               jl["freight"],
            "storage":               jl["storage"],
            "export_charges_doonta": jl["export_charges_doonta"],
            "jebel_ali":             jl["jebel_ali"],
            "export_transportation": jl["export_transportation"],
            "ectn":                  jl["ectn"],
            # Item-level
            "additional_costs":      add_costs   or None,
            "import_havinder":       None,
            "export_charges":        exp_charges or None,
            "export_havinder":       None,
            "total":                 total,
            "company_currency":      company_currency,        # for all distribution charges
            "source":                source,
        })

    return rows


# ─────────────────────────────────────────────────────────────────────────────
# Public API
# ─────────────────────────────────────────────────────────────────────────────

@frappe.whitelist()
def get_import_export_expense_report(filters=None):
    """
    Main report endpoint — returns 21-column item-based rows grouped by journey.
    """
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
        totals = defaultdict(float)

        for journey_id in all_journey_ids:
            pi_names = list(set(journey_to_pi.get(journey_id, [])))
            si_names = list(set(journey_to_si.get(journey_id, [])))
            display_name = journey_display.get(journey_id, journey_id.replace("|", " "))

            # Metadata from PI / SI directly
            import_container, import_bl = _collect_import_meta(pi_names)
            export_container, export_bl, destination = _collect_export_meta(si_names)

            # Units / Price / Total Value from SI item rows
            si_item_data = _collect_si_item_data(si_names, item_filter)

            # Import costs (LCV)
            import_costs, import_item_names, import_dates, currency = _aggregate_import_costs(
                pi_names, from_date, to_date, company_filter, currency_filter, item_filter
            )

            # Export costs (SSC)
            (
                export_costs, export_item_names, export_dates,
                freight, storage, export_charges_doonta,
                jebel_ali, export_transportation, ectn,
                ssc_company_currency,
            ) = _aggregate_export_costs(
                si_names, from_date, to_date, company_filter, currency_filter, item_filter
            )

            # Company currency for distribution charges:
            # LCV gives us the import company currency; SSC gives us export.
            # Prefer LCV currency if it's not USD, otherwise use SSC's.
            company_currency = currency if currency != "USD" else ssc_company_currency

            all_item_names  = {**export_item_names, **import_item_names}
            all_dates       = import_dates + export_dates

            # Transit numbers for tracking
            transit_no = _collect_transit_numbers(pi_names, si_names)

            journey_rows = _build_journey_rows(
                journey_id=journey_id, display_name=display_name,
                pi_names=pi_names, si_names=si_names,
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
                jebel_ali=jebel_ali,
                export_transportation=export_transportation,
                ectn=ectn,
                posting_dates=all_dates, company_currency=company_currency,
            )

            for row in journey_rows:
                totals["total_additional_costs"]      += row.get("additional_costs")      or 0
                totals["total_import_havinder"]        += row.get("import_havinder")       or 0
                totals["total_export_charges_doonta"]  += row.get("export_charges_doonta") or 0
                totals["total_jebel_ali"]              += row.get("jebel_ali")             or 0
                totals["total_export_charges"]         += row.get("export_charges")        or 0
                totals["total_export_havinder"]        += row.get("export_havinder")       or 0
                totals["total_freight"]                += row.get("freight")               or 0
                totals["total_storage"]                += row.get("storage")               or 0
                totals["total_export_transportation"]  += row.get("export_transportation") or 0
                totals["total_ectn"]                   += row.get("ectn")                  or 0
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
    """Distinct item codes from LCV and SSC for the filter dropdown."""
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