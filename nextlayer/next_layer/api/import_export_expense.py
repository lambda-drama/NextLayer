# # Copyright (c) Next Layer. Import & Export Expense Report API.
# """
# Transit Numbers child doctype schema (on Purchase Invoice / Sales Invoice):
#   parenttype    = "Purchase Invoice" or "Sales Invoice"
#   parent        = invoice name (e.g. "PINV-0001")
#   document_type = doctype of the LINKED invoice (e.g. "Sales Invoice")
#   transit_no    = name of the LINKED invoice (e.g. "SINV-0001")

# So a Purchase Invoice PINV-0001 linking to Sales Invoice SINV-0001 looks like:
#   parent=PINV-0001, parenttype=Purchase Invoice,
#   document_type=Sales Invoice, transit_no=SINV-0001

# To find all invoices in the same journey we do BFS:
#   - Forward: given (parenttype, parent) find all (document_type, transit_no) rows
#   - Reverse: given a name, find all Transit Numbers rows where transit_no = that name
#              → the parent of that row is the other invoice

# Child table reference (Sales Shipment Cost):
#   purchase_receipts → "Landed Cost Sales Invoice"
#                        .receipt_document_type = "Sales Invoice"
#                        .receipt_document       = SI name
#   taxes             → "Shipment Cost Distribution"
#                        .description, .amount
#   items             → "Sales Shipment Cost Item"
#                        .item_code, .applicable_charges
# """

# import frappe
# from frappe import _
# from frappe.utils import flt
# from collections import defaultdict


# # ─────────────────────────────────────────────────────────────────────────────
# # Utility helpers
# # ─────────────────────────────────────────────────────────────────────────────

# def _safe_get(doc, fieldname, default=""):
#     if doc is None:
#         return default
#     val = doc.get(fieldname)
#     return val if val is not None and val != "" else default


# def _transit_table_exists():
#     return frappe.db.table_exists("Transit Numbers")


# def _join_unique(values):
#     seen = []
#     for v in values:
#         if v and v not in seen:
#             seen.append(v)
#     return ", ".join(seen)


# def _get_company_currency(company_name):
#     if not company_name:
#         return "USD"
#     return frappe.get_cached_value("Company", company_name, "default_currency") or "USD"


# def _collect_transit_display(pi_names, si_names):
#     if not _transit_table_exists():
#         return ""
#     transit_nos = []
#     for pi_name in pi_names:
#         for row in frappe.get_all(
#             "Transit Numbers",
#             filters={"parent": pi_name, "parenttype": "Purchase Invoice",
#                      "document_type": "Sales Invoice"},
#             fields=["transit_no"],
#         ):
#             val = row.get("transit_no") or ""
#             if val and val not in transit_nos:
#                 transit_nos.append(val)
#     for si_name in si_names:
#         for row in frappe.get_all(
#             "Transit Numbers",
#             filters={"parent": si_name, "parenttype": "Sales Invoice",
#                      "document_type": "Purchase Invoice"},
#             fields=["transit_no"],
#         ):
#             val = row.get("transit_no") or ""
#             if val and val not in transit_nos:
#                 transit_nos.append(val)
#     return ", ".join(transit_nos)


# # ─────────────────────────────────────────────────────────────────────────────
# # Transit journey graph traversal (BFS)
# # ─────────────────────────────────────────────────────────────────────────────

# def _get_transit_neighbors(doctype, name):
#     if not _transit_table_exists():
#         return set()

#     neighbors = set()

#     for row in frappe.get_all(
#         "Transit Numbers",
#         filters={"parent": name, "parenttype": doctype},
#         fields=["document_type", "transit_no"],
#     ):
#         linked_type = row.get("document_type") or ""
#         linked_name = row.get("transit_no") or ""
#         if linked_type and linked_name:
#             neighbors.add((linked_type, linked_name))

#     for row in frappe.get_all(
#         "Transit Numbers",
#         filters={"transit_no": name},
#         fields=["parent", "parenttype"],
#     ):
#         parent_name = row.get("parent") or ""
#         parent_type = row.get("parenttype") or ""
#         if parent_name and parent_type:
#             neighbors.add((parent_type, parent_name))

#     return neighbors


# def _get_journey_component(doctype, name):
#     """BFS — return frozenset of all (doctype, name) in the same journey."""
#     visited = set()
#     queue   = [(doctype, name)]
#     while queue:
#         dt, n = queue.pop()
#         key = (dt, n)
#         if key in visited:
#             continue
#         visited.add(key)
#         for neighbor in _get_transit_neighbors(dt, n):
#             if neighbor not in visited:
#                 queue.append(neighbor)
#     return frozenset(visited)


# # ─────────────────────────────────────────────────────────────────────────────
# # Journey grouping
# #
# # FIX: Previously we looped PIs and SIs separately, which could create
# # duplicate journey IDs if the frozenset lookup had any edge-case mismatches.
# # Now we collect ALL candidate invoices first, then run a single unified BFS
# # pass so every invoice ends up in exactly one journey regardless of which
# # side (PI or SI) triggered the discovery.
# # ─────────────────────────────────────────────────────────────────────────────

# def _build_journey_map(from_date, to_date, company_filter):
#     """
#     Returns:
#         journey_to_pi:   dict[journey_id → list[pi_name]]
#         journey_to_si:   dict[journey_id → list[si_name]]
#         journey_display: dict[journey_id → display_label]

#     KEY CHANGE vs previous version
#     ────────────────────────────────
#     We collect all qualifying PIs and SIs into a single candidate set, then
#     run BFS once per unvisited node.  This guarantees that a PI and SI that
#     are linked via Transit Numbers always land in the same journey bucket —
#     even when one of them falls outside the date range (it gets pulled in by
#     the BFS of its linked partner that IS in range).
#     """
#     journey_to_pi   = defaultdict(list)
#     journey_to_si   = defaultdict(list)
#     journey_display = {}
#     seen_components = {}          # frozenset → journey_id
#     visited_nodes   = set()       # (doctype, name) already assigned

#     # ── Step 1: collect all qualifying invoice names ──────────────────────
#     pi_filters = [
#         ["Purchase Invoice", "docstatus",             "=",       1],
#         ["Purchase Invoice", "posting_date",          "between", [from_date, to_date]],
#         ["Purchase Invoice", "custom_is_export_sale", "=",       1],
#     ]
#     if company_filter:
#         pi_filters.append(["Purchase Invoice", "company", "=", company_filter])

#     si_filters = [
#         ["Sales Invoice", "docstatus",             "=",       1],
#         ["Sales Invoice", "posting_date",          "between", [from_date, to_date]],
#         ["Sales Invoice", "custom_is_export_sale", "=",       1],
#     ]
#     if company_filter:
#         si_filters.append(["Sales Invoice", "company", "=", company_filter])

#     # Build a set of (doctype, name) that are "in range" — these are the seeds
#     # for BFS.  The BFS itself may pull in invoices that are outside the date
#     # range (linked partners); that is intentional so costs are never orphaned.
#     seed_nodes = set()
#     for row in frappe.get_all("Purchase Invoice", filters=pi_filters, fields=["name"]):
#         if row.get("name"):
#             seed_nodes.add(("Purchase Invoice", row["name"]))
#     for row in frappe.get_all("Sales Invoice", filters=si_filters, fields=["name"]):
#         if row.get("name"):
#             seed_nodes.add(("Sales Invoice", row["name"]))

#     # ── Step 2: unified BFS pass ──────────────────────────────────────────
#     for (doctype, name) in seed_nodes:
#         if (doctype, name) in visited_nodes:
#             continue

#         # BFS expands to all linked invoices (regardless of date range)
#         component = _get_journey_component(doctype, name)

#         if component not in seen_components:
#             # Stable journey ID: sort the component and use the first element
#             first_dt, first_name = sorted(component)[0]
#             jid = f"{first_dt}|{first_name}"
#             seen_components[component] = jid
#             journey_display[jid] = first_name
#         else:
#             jid = seen_components[component]

#         # Mark every node in the component as visited so we don't re-process
#         visited_nodes.update(component)

#         # Distribute invoices to their respective buckets.
#         # We only add an invoice to a bucket if it was in our original seed set
#         # (i.e. it passed the date-range + company filter).  Invoices pulled in
#         # solely because they are linked partners are used for cost lookup only.
#         for (dt, n) in component:
#             if (dt, n) not in seed_nodes:
#                 continue          # linked partner outside date range — skip bucketing
#             if dt == "Purchase Invoice":
#                 if n not in journey_to_pi[jid]:
#                     journey_to_pi[jid].append(n)
#             elif dt == "Sales Invoice":
#                 if n not in journey_to_si[jid]:
#                     journey_to_si[jid].append(n)

#     return journey_to_pi, journey_to_si, journey_display


# # ─────────────────────────────────────────────────────────────────────────────
# # Container / B/L / Destination
# # ─────────────────────────────────────────────────────────────────────────────

# def _collect_import_meta(pi_names):
#     containers, bls = [], []
#     for name in pi_names:
#         try:
#             doc = frappe.get_doc("Purchase Invoice", name)
#             containers.append(_safe_get(doc, "custom_container_no"))
#             bls.append(_safe_get(doc, "custom_bill_of_landing"))
#         except Exception:
#             pass
#     return _join_unique(containers), _join_unique(bls)


# def _collect_export_meta(si_names):
#     containers, bls, destinations = [], [], []
#     for name in si_names:
#         try:
#             doc = frappe.get_doc("Sales Invoice", name)
#             containers.append(_safe_get(doc, "custom_container_no"))
#             bls.append(_safe_get(doc, "custom_bill_of_landing"))
#             destinations.append(_safe_get(doc, "custom_destination"))
#         except Exception:
#             pass
#     return _join_unique(containers), _join_unique(bls), _join_unique(destinations)


# # ─────────────────────────────────────────────────────────────────────────────
# # Units / Price / Total Value — from Sales Invoice item rows
# # ─────────────────────────────────────────────────────────────────────────────

# def _collect_si_item_data(si_names, item_filter):
#     item_data = {}
#     for si_name in si_names:
#         try:
#             si_doc = frappe.get_doc("Sales Invoice", si_name)
#             transaction_currency = si_doc.get("currency") or "USD"
#             company_currency     = _get_company_currency(si_doc.get("company"))

#             for row in si_doc.get("items") or []:
#                 ic = row.get("item_code") or ""
#                 if not ic or (item_filter and ic != item_filter):
#                     continue
#                 if ic not in item_data:
#                     item_data[ic] = {
#                         "units":                0.0,
#                         "price":                0.0,
#                         "total_value":          0.0,
#                         "transaction_currency": transaction_currency,
#                         "company_currency":     company_currency,
#                     }
#                 item_data[ic]["units"]       += flt(row.get("qty"),    2)
#                 item_data[ic]["price"]        = flt(row.get("rate"),   2)
#                 item_data[ic]["total_value"] += flt(row.get("amount"), 2)
#         except Exception:
#             pass
#     return item_data


# # ─────────────────────────────────────────────────────────────────────────────
# # Import cost aggregation — Landed Cost Vouchers
# #
# # FIX: si_set / pi_set are now built from ALL invoices in the journey
# # component, not just the ones that passed the date-range filter.
# # This means an LCV linked to a PI that was posted outside the report date
# # range (but belongs to an in-range journey) is no longer silently skipped.
# #
# # The caller passes `all_pi_names` (full component) and `seed_pi_names`
# # (only those within the date range, for display/bucketing).
# # ─────────────────────────────────────────────────────────────────────────────

# def _aggregate_import_costs(
#     pi_names, company_filter, currency_filter, item_filter
# ):
#     """
#     Sum LCV applicable_charges per item_code for LCVs linked to this journey's PIs.
#     pi_names should contain ALL PIs in the journey component (not just in-range ones).
#     """
#     item_costs    = defaultdict(float)
#     item_names    = {}
#     posting_dates = []
#     company_currency = None

#     if not pi_names:
#         return item_costs, item_names, posting_dates, company_currency

#     pi_set = set(pi_names)

#     lcv_filters = [["Landed Cost Voucher", "docstatus", "=", 1]]
#     if company_filter:
#         lcv_filters.append(["Landed Cost Voucher", "company", "=", company_filter])

#     for lcv_row in frappe.get_all(
#         "Landed Cost Voucher",
#         filters=lcv_filters,
#         fields=["name", "company", "posting_date"],
#         order_by="posting_date asc",
#     ):
#         lcv_name     = lcv_row.get("name")
#         lcv_company  = lcv_row.get("company") or ""
#         lcv_currency = _get_company_currency(lcv_company)

#         if currency_filter and currency_filter != "all" and lcv_currency != currency_filter:
#             continue

#         try:
#             lcv_doc = frappe.get_doc("Landed Cost Voucher", lcv_name)
#         except Exception:
#             continue

#         linked_pis = {
#             pr.get("receipt_document")
#             for pr in (lcv_doc.get("purchase_receipts") or [])
#             if pr.get("receipt_document_type") == "Purchase Invoice"
#             and pr.get("receipt_document")
#         }
#         if not (linked_pis & pi_set):
#             continue

#         if company_currency is None:
#             company_currency = lcv_currency

#         posting_dates.append(str(lcv_row.get("posting_date") or ""))

#         for item_row in lcv_doc.get("items") or []:
#             ic = item_row.get("item_code") or ""
#             if not ic or (item_filter and ic != item_filter):
#                 continue
#             item_costs[ic] += flt(item_row.get("applicable_charges"), 2)
#             if ic not in item_names:
#                 item_names[ic] = (
#                     item_row.get("description")
#                     or frappe.get_cached_value("Item", ic, "item_name")
#                     or ic
#                 )

#     return item_costs, item_names, posting_dates, company_currency


# # ─────────────────────────────────────────────────────────────────────────────
# # Export cost aggregation — Sales Shipment Costs
# # ─────────────────────────────────────────────────────────────────────────────

# def _aggregate_export_costs(
#     si_names, company_filter, currency_filter, item_filter
# ):
#     item_costs    = defaultdict(float)
#     item_names    = {}
#     posting_dates = []

#     freight               = 0.0
#     storage               = 0.0
#     export_charges_doonta = 0.0

#     # SSC applicable_charges are always stored in USD (not company currency)
#     ssc_company_currency = "USD"

#     if not si_names or not frappe.db.table_exists("Sales Shipment Cost"):
#         return (
#             item_costs, item_names, posting_dates,
#             freight, storage, export_charges_doonta,
#             ssc_company_currency,
#         )

#     si_set = set(si_names)

#     ssc_filters = [["Sales Shipment Cost", "docstatus", "=", 1]]
#     if company_filter:
#         ssc_filters.append(["Sales Shipment Cost", "company", "=", company_filter])

#     for ssc_row in frappe.get_all(
#         "Sales Shipment Cost",
#         filters=ssc_filters,
#         fields=["name", "posting_date"],
#         order_by="posting_date asc",
#     ):
#         try:
#             ssc_doc = frappe.get_doc("Sales Shipment Cost", ssc_row.name)
#         except Exception:
#             continue

#         linked_sis = {
#             r.get("receipt_document")
#             for r in (ssc_doc.get("purchase_receipts") or [])
#             if r.get("receipt_document_type") == "Sales Invoice"
#             and r.get("receipt_document")
#         }
#         if not (linked_sis & si_set):
#             continue

#         # SSC amounts are always in USD — no per-doc currency derivation needed
#         if currency_filter and currency_filter != "all" and currency_filter != "USD":
#             continue

#         posting_dates.append(str(ssc_doc.posting_date or ""))

#         for tax in (ssc_doc.get("taxes") or []):
#             desc = (tax.get("description") or "").lower()
#             amt  = flt(tax.get("amount"), 2)

#             if "freight" in desc:
#                 freight               += amt
#             elif "storage" in desc:
#                 storage               += amt
#             elif "doonta" in desc:
#                 export_charges_doonta += amt

#         for item_row in (ssc_doc.get("items") or []):
#             ic = item_row.get("item_code") or ""
#             if not ic or (item_filter and ic != item_filter):
#                 continue
#             item_costs[ic] += flt(item_row.get("applicable_charges"), 2)
#             if ic not in item_names:
#                 item_names[ic] = (
#                     item_row.get("description")
#                     or frappe.get_cached_value("Item", ic, "item_name")
#                     or ic
#                 )

#     return (
#         item_costs, item_names, posting_dates,
#         freight, storage, export_charges_doonta,
#         ssc_company_currency,
#     )


# # ─────────────────────────────────────────────────────────────────────────────
# # Expand journey component to get ALL linked PIs / SIs
# # (includes invoices outside the date range that are linked partners)
# # ─────────────────────────────────────────────────────────────────────────────

# def _expand_journey_invoices(pi_names, si_names):
#     """
#     Given the seed PI/SI names (those that passed the date filter), run BFS
#     on each to collect ALL invoices in the full journey component.
#     Returns (all_pi_names, all_si_names) — supersets of the input lists.

#     This is used so that cost aggregation (LCVs / SSCs) can find documents
#     linked to out-of-range partners.
#     """
#     all_pi = set(pi_names)
#     all_si = set(si_names)

#     seeds = (
#         [("Purchase Invoice", n) for n in pi_names] +
#         [("Sales Invoice",    n) for n in si_names]
#     )
#     for doctype, name in seeds:
#         for (dt, n) in _get_journey_component(doctype, name):
#             if dt == "Purchase Invoice":
#                 all_pi.add(n)
#             elif dt == "Sales Invoice":
#                 all_si.add(n)

#     return list(all_pi), list(all_si)


# # ─────────────────────────────────────────────────────────────────────────────
# # Row building — one row per (journey, item)
# # ─────────────────────────────────────────────────────────────────────────────

# def _fmt_dates(dates):
#     return ", ".join(filter(None, sorted(set(dates))))[:100]


# def _build_journey_rows(
#     journey_id, display_name, pi_names, si_names,
#     import_item_costs, export_item_costs, all_item_names,
#     si_item_data, transit_no,
#     import_container, import_bl,
#     export_container, export_bl, destination,
#     freight, storage, export_charges_doonta,
#     posting_dates, company_currency, export_currency="USD",
# ):
#     rows = []
#     source = (
#         "both"   if (pi_names and si_names) else
#         "import" if pi_names else
#         "export"
#     )
#     date_str       = _fmt_dates(posting_dates)
#     all_item_codes = sorted(set(import_item_costs.keys()) | set(export_item_costs.keys()))

#     journey_level = {
#         "freight":               freight,
#         "storage":               storage,
#         "export_charges_doonta": export_charges_doonta,
#     }

#     if not all_item_codes:
#         jl_total = sum(journey_level.values())
#         if jl_total:
#             rows.append({
#                 "journey_id":            journey_id,
#                 "transit_display":       display_name,
#                 "transit_no":            transit_no,
#                 "item_code":             "",
#                 "item_name":             "",
#                 "description":           "",
#                 "units":                 None,
#                 "price":                 None,
#                 "total_value":           None,
#                 "transaction_currency":  company_currency,
#                 "posting_date":          date_str,
#                 "import_container":      import_container or "—",
#                 "export_container":      export_container or "—",
#                 "import_bl":             import_bl        or "—",
#                 "export_bl":             export_bl        or "—",
#                 "destination":           destination      or "—",
#                 "freight":               freight  or None,
#                 "storage":               storage  or None,
#                 "export_charges_doonta": export_charges_doonta or None,
#                 "additional_costs":      None,
#                 "export_charges":        None,
#                 "total":                 jl_total,
#                 "company_currency":      company_currency,
#                 "export_currency":       export_currency,
#                 "source":                source,
#             })
#         return rows

#     for idx, item_code in enumerate(all_item_codes):
#         is_first    = idx == 0
#         add_costs   = flt(import_item_costs.get(item_code, 0), 2)
#         exp_charges = flt(export_item_costs.get(item_code, 0), 2)
#         si_meta     = si_item_data.get(item_code, {})

#         jl     = {k: (v or None) if is_first else None for k, v in journey_level.items()}
#         jl_sum = sum(journey_level.values()) if is_first else 0.0
#         total  = add_costs + exp_charges + jl_sum

#         desc = (
#             all_item_names.get(item_code)
#             or frappe.get_cached_value("Item", item_code, "item_name")
#             or item_code
#         )

#         transaction_currency = si_meta.get("transaction_currency") or company_currency

#         rows.append({
#             "journey_id":            journey_id,
#             "transit_display":       display_name,
#             "transit_no":            transit_no,
#             "item_code":             item_code,
#             "item_name":             item_code,
#             "description":           desc,
#             "units":                 si_meta.get("units")       or None,
#             "price":                 si_meta.get("price")       or None,
#             "total_value":           si_meta.get("total_value") or None,
#             "transaction_currency":  transaction_currency,
#             "posting_date":          date_str,
#             "import_container":      import_container or "—",
#             "export_container":      export_container or "—",
#             "import_bl":             import_bl        or "—",
#             "export_bl":             export_bl        or "—",
#             "destination":           destination      or "—",
#             "freight":               jl["freight"],
#             "storage":               jl["storage"],
#             "export_charges_doonta": jl["export_charges_doonta"],
#             "additional_costs":      add_costs   or None,
#             "export_charges":        exp_charges or None,
#             "total":                 total,
#             "company_currency":      company_currency,
#             "export_currency":       export_currency,
#             "source":                source,
#         })

#     return rows


# # ─────────────────────────────────────────────────────────────────────────────
# # Public API
# # ─────────────────────────────────────────────────────────────────────────────

# @frappe.whitelist()
# def get_import_export_expense_report(filters=None):
#     """Main report endpoint — returns item-based rows grouped by journey."""
#     try:
#         if filters is None:
#             filters = frappe.form_dict
#         if isinstance(filters, str):
#             filters = frappe.parse_json(filters)
#         filters = filters or {}

#         from_date = filters.get("from_date")
#         to_date   = filters.get("to_date")
#         if not from_date or not to_date:
#             frappe.throw(_("From Date and To Date are required"))

#         company_filter  = filters.get("company")  or ""
#         item_filter     = filters.get("item")      or ""
#         currency_filter = filters.get("currency")  or ""

#         journey_to_pi, journey_to_si, journey_display = _build_journey_map(
#             from_date, to_date, company_filter
#         )
#         all_journey_ids = sorted(set(journey_to_pi.keys()) | set(journey_to_si.keys()))

#         entries = []
#         totals  = defaultdict(float)

#         for journey_id in all_journey_ids:
#             pi_names     = list(set(journey_to_pi.get(journey_id, [])))
#             si_names     = list(set(journey_to_si.get(journey_id, [])))
#             display_name = journey_display.get(journey_id, journey_id.replace("|", " "))

#             # ── Expand to full journey component ────────────────────────────
#             # This pulls in any linked PIs/SIs that were outside the date
#             # range, ensuring LCVs and SSCs linked to them are not missed.
#             all_pi_names, all_si_names = _expand_journey_invoices(pi_names, si_names)

#             import_container, import_bl              = _collect_import_meta(pi_names)
#             export_container, export_bl, destination = _collect_export_meta(si_names)

#             # SI item data uses only the in-range SIs (display / price data)
#             si_item_data = _collect_si_item_data(si_names, item_filter)

#             # ── Import costs: use ALL PIs in the component ──────────────────
#             import_costs, import_item_names, import_dates, lcv_currency = \
#                 _aggregate_import_costs(all_pi_names, company_filter, currency_filter, item_filter)

#             # ── Export costs: use ALL SIs in the component ──────────────────
#             (
#                 export_costs, export_item_names, export_dates,
#                 freight, storage, export_charges_doonta,
#                 ssc_currency,
#             ) = _aggregate_export_costs(all_si_names, company_filter, currency_filter, item_filter)

#             # ── Company currency resolution ──────────────────────────────────
#             if company_filter:
#                 company_currency = _get_company_currency(company_filter)
#             elif lcv_currency is not None:
#                 company_currency = lcv_currency
#             elif ssc_currency is not None:
#                 company_currency = ssc_currency
#             else:
#                 company_currency = "USD"

#             all_item_names = {**export_item_names, **import_item_names}
#             all_dates      = import_dates + export_dates

#             transit_no = _collect_transit_display(pi_names, si_names)

#             journey_rows = _build_journey_rows(
#                 journey_id=journey_id, display_name=display_name,
#                 pi_names=pi_names,     si_names=si_names,
#                 import_item_costs=import_costs,
#                 export_item_costs=export_costs,
#                 all_item_names=all_item_names,
#                 si_item_data=si_item_data,
#                 transit_no=transit_no,
#                 import_container=import_container, import_bl=import_bl,
#                 export_container=export_container, export_bl=export_bl,
#                 destination=destination,
#                 freight=freight, storage=storage,
#                 export_charges_doonta=export_charges_doonta,
#                 posting_dates=all_dates, company_currency=company_currency,
#                 export_currency="USD",   # SSC applicable_charges are always USD
#             )

#             for row in journey_rows:
#                 totals["total_additional_costs"]       += row.get("additional_costs")      or 0
#                 totals["total_export_charges_doonta"]  += row.get("export_charges_doonta") or 0
#                 totals["total_export_charges"]         += row.get("export_charges")        or 0
#                 totals["total_freight"]                += row.get("freight")               or 0
#                 totals["total_storage"]                += row.get("storage")               or 0
#                 totals["grand_total"]                  += row.get("total")                 or 0

#             entries.extend(journey_rows)

#         return {
#             "success": True,
#             "entries": entries,
#             "totals":  {k: flt(v, 2) for k, v in totals.items()},
#             "filters_applied": {
#                 "from_date": from_date,
#                 "to_date":   to_date,
#                 "company":   company_filter,
#                 "item":      item_filter,
#                 "currency":  currency_filter or "all",
#             },
#         }

#     except Exception as e:
#         frappe.log_error(f"Import & Export Expense Report Error: {str(e)}")
#         return {
#             "success": False,
#             "error":   str(e),
#             "message": _("Failed to fetch Import & Export expense data"),
#             "entries": [],
#             "totals":  {},
#         }


# @frappe.whitelist()
# def get_items_for_import_export_filter():
#     """Distinct item codes from LCV items and Sales Shipment Cost items."""
#     try:
#         items = set()

#         if frappe.db.table_exists("Landed Cost Item"):
#             for row in frappe.db.sql(
#                 "SELECT DISTINCT item_code FROM `tabLanded Cost Item` "
#                 "WHERE item_code IS NOT NULL AND item_code != ''",
#                 as_dict=True,
#             ):
#                 if row.get("item_code"):
#                     items.add(row["item_code"])

#         if frappe.db.table_exists("Sales Shipment Cost Item"):
#             for row in frappe.db.sql(
#                 "SELECT DISTINCT item_code FROM `tabSales Shipment Cost Item` "
#                 "WHERE item_code IS NOT NULL AND item_code != ''",
#                 as_dict=True,
#             ):
#                 if row.get("item_code"):
#                     items.add(row["item_code"])

#         return {
#             "success": True,
#             "items":   [{"name": i, "value": i} for i in sorted(items)],
#         }
#     except Exception as e:
#         frappe.log_error(f"get_items_for_import_export_filter: {str(e)}")
#         return {"success": False, "items": [], "error": str(e)}

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

def _aggregate_import_costs_bulk(pi_names, company_filter, currency_filter, item_filter):
    """
    Bulk version:
      1. Find all LCV names linked to any of pi_names via purchase_receipts — ONE query.
      2. Fetch all their item rows — ONE query.
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

    # Apply currency filter (company_currency is derived from company)
    filtered_lcv_names = []
    company_currency   = None
    posting_dates      = []
    for r in lcv_rows:
        lc = _get_company_currency(r.lcv_company)
        if currency_filter and currency_filter != "all" and lc != currency_filter:
            continue
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

def _aggregate_export_costs_bulk(si_names, company_filter, currency_filter, item_filter):
    if not si_names or not frappe.db.table_exists("Sales Shipment Cost"):
        return defaultdict(float), {}, [], 0.0, 0.0, 0.0, "USD"

    # Currency filter: SSC charges are USD-based
    if currency_filter and currency_filter != "all" and currency_filter != "USD":
        return defaultdict(float), {}, [], 0.0, 0.0, 0.0, "USD"

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
                "export_currency":       export_currency,
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
            "export_currency":       export_currency,
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
                _aggregate_import_costs_bulk(all_pi_names, company_filter, currency_filter, item_filter)

            # Export costs — bulk
            (
                export_costs, export_item_names, export_dates,
                freight, storage, export_charges_doonta,
                ssc_currency,
            ) = _aggregate_export_costs_bulk(all_si_names, company_filter, currency_filter, item_filter)

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