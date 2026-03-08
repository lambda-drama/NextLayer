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


def _collect_transit_display(pi_names, si_names):
    if not _transit_table_exists():
        return ""
    transit_nos = []

    if pi_names:
        rows = frappe.db.sql("""
            SELECT transit_no FROM `tabTransit Numbers`
            WHERE parent IN %(pi)s AND parenttype='Purchase Invoice'
              AND document_type='Sales Invoice'
              AND transit_no IS NOT NULL AND transit_no != ''
        """, {"pi": pi_names}, as_dict=True)
        for r in rows:
            if r.transit_no not in transit_nos:
                transit_nos.append(r.transit_no)

    if si_names:
        rows = frappe.db.sql("""
            SELECT transit_no FROM `tabTransit Numbers`
            WHERE parent IN %(si)s AND parenttype='Sales Invoice'
              AND document_type='Purchase Invoice'
              AND transit_no IS NOT NULL AND transit_no != ''
        """, {"si": si_names}, as_dict=True)
        for r in rows:
            if r.transit_no not in transit_nos:
                transit_nos.append(r.transit_no)

    return ", ".join(transit_nos)


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

def _build_journey_map(from_date, to_date, company_filter):
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
        ["Purchase Invoice", "docstatus",             "=",       1],
        ["Purchase Invoice", "posting_date",          "between", [from_date, to_date]],
        ["Purchase Invoice", "custom_is_export_sale", "=",       1],
    ]
    if company_filter:
        pi_filters.append(["Purchase Invoice", "company", "=", company_filter])

    si_filters = [
        ["Sales Invoice", "docstatus",             "=",       1],
        ["Sales Invoice", "posting_date",          "between", [from_date, to_date]],
        ["Sales Invoice", "custom_is_export_sale", "=",       1],
    ]
    if company_filter:
        si_filters.append(["Sales Invoice", "company", "=", company_filter])

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

def _collect_si_item_data_bulk(si_names, item_filter):
    """Return {item_code: {units, price, total_value, transaction_currency, company_currency}}."""
    if not si_names:
        return {}

    # Fetch SI header currency info in one shot
    si_meta_rows = frappe.db.sql("""
        SELECT name, currency, company
        FROM `tabSales Invoice`
        WHERE name IN %(names)s
    """, {"names": si_names}, as_dict=True)

    si_currency_map  = {r.name: r.currency  or "USD"  for r in si_meta_rows}
    si_company_map   = {r.name: r.company   or ""     for r in si_meta_rows}

    # Fetch all item rows in one shot
    item_clause = "AND sii.item_code = %(item)s" if item_filter else ""
    rows = frappe.db.sql(f"""
        SELECT sii.parent, sii.item_code, sii.qty, sii.rate, sii.amount
        FROM `tabSales Invoice Item` sii
        WHERE sii.parent IN %(names)s
          {item_clause}
          AND sii.item_code IS NOT NULL AND sii.item_code != ''
    """, {"names": si_names, "item": item_filter}, as_dict=True)

    item_data = {}
    for r in rows:
        ic = r.item_code
        if ic not in item_data:
            tc = si_currency_map.get(r.parent, "USD")
            cc = _get_company_currency(si_company_map.get(r.parent, ""))
            item_data[ic] = {
                "units":                0.0,
                "price":                0.0,
                "total_value":          0.0,
                "transaction_currency": tc,
                "company_currency":     cc,
            }
        item_data[ic]["units"]       += flt(r.qty,    2)
        item_data[ic]["price"]        = flt(r.rate,   2)
        item_data[ic]["total_value"] += flt(r.amount, 2)

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


# ─────────────────────────────────────────────────────────────────────────────
# Import cost aggregation — Landed Cost Vouchers (bulk)
# ─────────────────────────────────────────────────────────────────────────────

def _aggregate_import_costs_bulk(pi_names, company_filter, item_filter):
    """
    Bulk version:
      1. Find all LCV names linked to any of pi_names via purchase_receipts — ONE query.
      2. Fetch all their item rows — ONE query.

    NOTE: currency_filter intentionally removed — the currency selector is display-only
    and should never exclude records. All data is always returned in its native currency.
    """
    if not pi_names:
        return defaultdict(float), {}, [], None

    # ── Step 1: find matching LCVs ────────────────────────────────────────
    company_clause = "AND lcv.company = %(company)s" if company_filter else ""
    lcv_rows = frappe.db.sql(f"""
        SELECT DISTINCT
            lcv.name          AS lcv_name,
            lcv.company       AS lcv_company,
            lcv.posting_date  AS posting_date
        FROM `tabLanded Cost Voucher` lcv
        INNER JOIN `tabLanded Cost Purchase Receipt` lcpr
            ON lcpr.parent = lcv.name
        WHERE lcv.docstatus = 1
          AND lcpr.receipt_document_type = 'Purchase Invoice'
          AND lcpr.receipt_document IN %(pi_names)s
          {company_clause}
        ORDER BY lcv.posting_date ASC
    """, {"pi_names": pi_names, "company": company_filter}, as_dict=True)

    if not lcv_rows:
        return defaultdict(float), {}, [], None

    # Collect all LCVs — no currency exclusion, just derive company_currency from first
    filtered_lcv_names = []
    company_currency   = None
    posting_dates      = []
    for r in lcv_rows:
        lc = _get_company_currency(r.lcv_company)
        if company_currency is None:
            company_currency = lc
        filtered_lcv_names.append(r.lcv_name)
        posting_dates.append(str(r.posting_date or ""))

    if not filtered_lcv_names:
        return defaultdict(float), {}, [], company_currency

    # ── Step 2: fetch all item rows for those LCVs ────────────────────────
    item_clause = "AND lci.item_code = %(item)s" if item_filter else ""
    item_rows = frappe.db.sql(f"""
        SELECT lci.item_code, lci.applicable_charges, lci.description
        FROM `tabLanded Cost Item` lci
        WHERE lci.parent IN %(lcv_names)s
          AND lci.item_code IS NOT NULL AND lci.item_code != ''
          {item_clause}
    """, {"lcv_names": filtered_lcv_names, "item": item_filter}, as_dict=True)

    item_costs = defaultdict(float)
    item_names = {}
    for r in item_rows:
        ic = r.item_code
        item_costs[ic] += flt(r.applicable_charges, 2)
        if ic not in item_names:
            item_names[ic] = r.description or ic

    return item_costs, item_names, posting_dates, company_currency


# ─────────────────────────────────────────────────────────────────────────────
# Export cost aggregation — Sales Shipment Costs (bulk)
# ─────────────────────────────────────────────────────────────────────────────

def _aggregate_export_costs_bulk(si_names, company_filter, item_filter):
    if not si_names or not frappe.db.table_exists("Sales Shipment Cost"):
        return defaultdict(float), {}, [], 0.0, 0.0, 0.0, "USD"

    # SSC applicable_charges are always USD — currency filter is display-only, never excludes data
    company_clause = "AND ssc.company = %(company)s" if company_filter else ""

    # ── Step 1: find matching SSCs ────────────────────────────────────────
    ssc_rows = frappe.db.sql(f"""
        SELECT DISTINCT ssc.name AS ssc_name, ssc.posting_date
        FROM `tabSales Shipment Cost` ssc
        INNER JOIN `tabLanded Cost Sales Invoice` lcsi
            ON lcsi.parent = ssc.name
        WHERE ssc.docstatus = 1
          AND lcsi.receipt_document_type = 'Sales Invoice'
          AND lcsi.receipt_document IN %(si_names)s
          {company_clause}
        ORDER BY ssc.posting_date ASC
    """, {"si_names": si_names, "company": company_filter}, as_dict=True)

    if not ssc_rows:
        return defaultdict(float), {}, [], 0.0, 0.0, 0.0, "USD"

    ssc_names     = [r.ssc_name for r in ssc_rows]
    posting_dates = [str(r.posting_date or "") for r in ssc_rows]

    # ── Step 2: fetch taxes (freight / storage / doonta) in one query ─────
    freight = storage = export_charges_doonta = 0.0

    if frappe.db.table_exists("Shipment Cost Distribution"):
        tax_rows = frappe.db.sql("""
            SELECT description, amount
            FROM `tabShipment Cost Distribution`
            WHERE parent IN %(ssc_names)s
        """, {"ssc_names": ssc_names}, as_dict=True)
        for t in tax_rows:
            desc = (t.description or "").lower()
            amt  = flt(t.amount, 2)
            if "freight" in desc:
                freight               += amt
            elif "storage" in desc:
                storage               += amt
            elif "doonta" in desc:
                export_charges_doonta += amt

    # ── Step 3: fetch item rows in one query ──────────────────────────────
    item_clause = "AND item_code = %(item)s" if item_filter else ""
    item_rows = frappe.db.sql(f"""
        SELECT item_code, applicable_charges, description
        FROM `tabSales Shipment Cost Item`
        WHERE parent IN %(ssc_names)s
          AND item_code IS NOT NULL AND item_code != ''
          {item_clause}
    """, {"ssc_names": ssc_names, "item": item_filter}, as_dict=True)

    item_costs = defaultdict(float)
    item_names = {}
    for r in item_rows:
        ic = r.item_code
        item_costs[ic] += flt(r.applicable_charges, 2)
        if ic not in item_names:
            item_names[ic] = r.description or ic

    return item_costs, item_names, posting_dates, freight, storage, export_charges_doonta, "USD"


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
# Row building
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
    posting_dates, company_currency, export_currency="USD",
    display_currency=None, conversion_date=None,
):
    """
    display_currency: if set, all monetary amounts are converted to this currency
                      using convert_currency() before being placed in the row.
    conversion_date:  date to use for the exchange rate lookup (defaults to today).
    """
    def _cc(amount, from_currency):
        """Convert `amount` from `from_currency` to `display_currency` if needed."""
        if not display_currency or not amount or from_currency == display_currency:
            return amount
        try:
            date = conversion_date or frappe.utils.nowdate()
            return flt(convert_currency(amount, display_currency, from_currency,  date), 2)
        except Exception:
            return amount  # fall back to native value on any rate error

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

    # Determine the effective display currency for this journey
    eff_cc  = display_currency or company_currency
    eff_usd = display_currency or export_currency

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
                "transaction_currency":  eff_cc,
                "posting_date":          date_str,
                "import_container":      import_container or "—",
                "export_container":      export_container or "—",
                "import_bl":             import_bl        or "—",
                "export_bl":             export_bl        or "—",
                "destination":           destination      or "—",
                "freight":               _cc(freight, company_currency)  or None,
                "storage":               _cc(storage, company_currency)  or None,
                "export_charges_doonta": _cc(export_charges_doonta, export_currency) or None,
                "additional_costs":      None,
                "export_charges":        None,
                "total":                 _cc(jl_total, company_currency),
                "company_currency":      eff_cc,
                "export_currency":       eff_usd,
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
        eff_tx = display_currency or transaction_currency

        rows.append({
            "journey_id":            journey_id,
            "transit_display":       display_name,
            "transit_no":            transit_no,
            "item_code":             item_code,
            "item_name":             item_code,
            "description":           desc,
            "units":                 si_meta.get("units") or None,
            "price":                 _cc(si_meta.get("price"),       transaction_currency) or None,
            "total_value":           _cc(si_meta.get("total_value"), transaction_currency) or None,
            "transaction_currency":  eff_tx,
            "posting_date":          date_str,
            "import_container":      import_container or "—",
            "export_container":      export_container or "—",
            "import_bl":             import_bl        or "—",
            "export_bl":             export_bl        or "—",
            "destination":           destination      or "—",
            "freight":               _cc(jl["freight"],               company_currency),
            "storage":               _cc(jl["storage"],               company_currency),
            "export_charges_doonta": _cc(jl["export_charges_doonta"], export_currency),
            "additional_costs":      _cc(add_costs,   company_currency) or None,
            "export_charges":        _cc(exp_charges, export_currency)  or None,
            "total":                 _cc(add_costs, company_currency) + _cc(exp_charges, export_currency) + (
                                         _cc(sum(journey_level.values()), company_currency) if is_first else 0.0
                                     ),
            "company_currency":      eff_cc,
            "export_currency":       eff_usd,
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
        currency_filter   = filters.get("currency")  or ""
        # display_currency: non-empty, non-"all" value means "convert everything to this"
        display_currency  = currency_filter if (currency_filter and currency_filter != "all") else None

        journey_to_pi, journey_to_si, journey_display = _build_journey_map(
            from_date, to_date, company_filter
        )
        all_journey_ids = sorted(set(journey_to_pi.keys()) | set(journey_to_si.keys()))

        # ── Pre-fetch ALL item names needed across ALL journeys in one shot ──
        # We'll collect them after cost aggregation but before row building.
        # This avoids repeated get_cached_value() calls per item per journey.

        entries = []
        totals  = defaultdict(float)

        for journey_id in all_journey_ids:
            pi_names     = list(set(journey_to_pi.get(journey_id, [])))
            si_names     = list(set(journey_to_si.get(journey_id, [])))
            display_name = journey_display.get(journey_id, journey_id.replace("|", " "))

            # Expand to full journey component for cost lookups
            all_pi_names, all_si_names = _expand_journey_invoices(pi_names, si_names)

            # Bulk meta (single SQL each)
            import_container, import_bl              = _collect_import_meta_bulk(pi_names)
            export_container, export_bl, destination = _collect_export_meta_bulk(si_names)

            # SI item data — bulk
            si_item_data = _collect_si_item_data_bulk(si_names, item_filter)

            # Import costs — bulk
            import_costs, import_item_names, import_dates, lcv_currency = \
                _aggregate_import_costs_bulk(all_pi_names, company_filter, item_filter)

            # Export costs — bulk
            (
                export_costs, export_item_names, export_dates,
                freight, storage, export_charges_doonta,
                ssc_currency,
            ) = _aggregate_export_costs_bulk(all_si_names, company_filter, item_filter)

            # Company currency resolution
            if company_filter:
                company_currency = _get_company_currency(company_filter)
            elif lcv_currency is not None:
                company_currency = lcv_currency
            elif ssc_currency is not None:
                company_currency = ssc_currency
            else:
                company_currency = "USD"

            # Merge item names; bulk-fetch unknowns
            all_item_names = {**export_item_names, **import_item_names}
            unknown_codes  = [
                ic for ic in (set(import_costs.keys()) | set(export_costs.keys()))
                if ic not in all_item_names
            ]
            if unknown_codes:
                all_item_names.update(_bulk_item_names(unknown_codes))

            all_dates  = import_dates + export_dates
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
                export_currency="USD",
                # Currency conversion — use to_date as the exchange rate date
                display_currency=display_currency or None,
                conversion_date=to_date,
            )

            for row in journey_rows:
                totals["total_additional_costs"]       += row.get("additional_costs")      or 0
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