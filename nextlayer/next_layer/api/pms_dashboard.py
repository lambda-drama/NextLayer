"""
pms_dashboard.py
----------------
Whitelisted API endpoints powering the Property Management Dashboard.
"""

import frappe
from frappe import _
from frappe.utils import nowdate, flt, getdate, add_months, add_days, get_first_day, get_last_day
from datetime import date
import calendar


# ─────────────────────────────────────────────────────────────────────────────
#  COMPANY SCOPE (aligned with wage_report / ledger-style permissions)
# ─────────────────────────────────────────────────────────────────────────────

def _allowed_company_rows():
	all_cos = frappe.get_all(
		"Company",
		fields=["name", "company_name"],
		order_by="name",
	)
	user_permitted = frappe.permissions.get_user_permissions(frappe.session.user)
	permitted_names = []
	if user_permitted and "Company" in user_permitted:
		permitted_names = [perm.get("doc") for perm in user_permitted["Company"]]

	if permitted_names:
		return [c for c in all_cos if c.name in permitted_names]
	return list(all_cos)


def _allowed_company_names():
	return {c.name for c in _allowed_company_rows()}


def _ensure_company_allowed(company):
	if not company:
		return
	if company not in _allowed_company_names():
		frappe.throw(_("No permission for company {0}").format(company), frappe.PermissionError)


def _pms_effective_companies(requested_company=None):
	allowed = sorted(_allowed_company_names())
	if not allowed:
		return []
	if requested_company:
		_ensure_company_allowed(requested_company)
		return [requested_company]
	return allowed


def _property_names_for_companies(companies):
	if not companies:
		return []
	return frappe.get_all("Property", filters={"company": ["in", companies]}, pluck="name")


def _ensure_unit_company_allowed(unit_doc, requested_company=None):
	all_allowed = _allowed_company_names()
	prop_company = frappe.db.get_value("Property", unit_doc.property, "company")
	if not prop_company or prop_company not in all_allowed:
		frappe.throw(_("Not permitted to view this unit."), frappe.PermissionError)
	effective = _pms_effective_companies(requested_company)
	if prop_company not in effective:
		frappe.throw(_("This unit does not belong to the selected company."), frappe.PermissionError)


@frappe.whitelist()
def get_pms_dashboard_companies():
	rows = _allowed_company_rows()
	return {
		"companies": [{"value": r.name, "label": r.get("company_name") or r.name} for r in rows],
	}


# ─────────────────────────────────────────────────────────────────────────────
#  OVERVIEW
# ─────────────────────────────────────────────────────────────────────────────

@frappe.whitelist()
def get_dashboard_overview(company=None):
	"""
	Return all KPIs needed for the Overview tab:
	  - property / unit counts
	  - active contracts
	  - occupancy rate
	  - monthly revenue (current month)
	  - lease status breakdown
	  - top-5 tenants by monthly rent
	  - last-6-months revenue trend

	Optional ``company``: restrict to one permitted company (omit / None for all permitted).
	"""

	companies = _pms_effective_companies(company or None)
	today = getdate(nowdate())

	if not companies:
		return {
			"total_properties": 0,
			"total_units": 0,
			"occupied_units": 0,
			"vacant_units": 0,
			"occupancy_rate": 0,
			"active_contracts": 0,
			"total_contracts": 0,
			"expired_contracts": 0,
			"terminated_contracts": 0,
			"expiring_soon": 0,
			"monthly_revenue": 0,
			"monthly_paid": 0,
			"total_outstanding": 0,
			"lease_status": {},
			"top_tenants": [],
			"revenue_trend": [],
			"property_stats": [],
		}

	prop_names = _property_names_for_companies(companies)
	contract_base = {"docstatus": 1, "company": ["in", companies]}
	si_pms_base = {
		"custom_tenant_contract": ["!=", ""],
		"company": ["in", companies],
	}

	# ── Property & Unit counts ──────────────────────────────────────────────
	total_properties = frappe.db.count("Property", filters={"company": ["in", companies]})
	unit_filters = {"property": ["in", prop_names]} if prop_names else {"name": "__DOES_NOT_EXIST__"}
	unit_data = frappe.db.get_all("Unit", fields=["status"], filters=unit_filters)
	total_units = len(unit_data)
	occupied = sum(1 for u in unit_data if u.status == "Occupied")
	vacant = total_units - occupied
	occupancy_rate = round((occupied / total_units * 100), 1) if total_units else 0

	# ── Active contracts ────────────────────────────────────────────────────
	contract_data = frappe.db.get_all(
		"Tenant Contract",
		filters=contract_base,
		fields=["status"],
	)
	active_contracts = sum(1 for c in contract_data if c.status == "Active")

	# Lease status breakdown (for all submitted contracts)
	lease_status = {}
	for c in contract_data:
		lease_status[c.status] = lease_status.get(c.status, 0) + 1

	total_contracts   = len(contract_data)
	expired_contracts    = lease_status.get("Expired", 0)
	terminated_contracts = lease_status.get("Terminated", 0)

	# Contracts expiring within next 30 days
	expiry_cutoff = add_days(today, 30)
	expiring_soon = frappe.db.count("Tenant Contract", filters={
		**contract_base,
		"status": "Active",
		"end_date": ["between", [today, expiry_cutoff]],
	})

	# ── Monthly revenue (current month invoiced & submitted) ────────────────
	month_start = get_first_day(today)
	month_end = get_last_day(today)

	monthly_invoices = frappe.db.get_all(
		"Sales Invoice",
		filters={
			**si_pms_base,
			"docstatus": 1,
			"posting_date": ["between", [month_start, month_end]],
		},
		fields=["grand_total", "outstanding_amount"],
	)
	monthly_revenue = sum(flt(i.grand_total) for i in monthly_invoices)
	monthly_paid    = sum(flt(i.grand_total) - flt(i.outstanding_amount) for i in monthly_invoices)

	# Outstanding balance (submitted invoices not fully paid)
	outstanding_invoices = frappe.db.get_all(
		"Sales Invoice",
		filters={
			**si_pms_base,
			"docstatus": 1,
			"outstanding_amount": [">", 0],
		},
		fields=["outstanding_amount"],
	)
	total_outstanding = sum(flt(i.outstanding_amount) for i in outstanding_invoices)

	# ── Top-5 tenants by monthly rent ───────────────────────────────────────
	top_tenants_raw = frappe.db.get_all(
		"Tenant Contract",
		filters={**contract_base, "status": "Active"},
		fields=["party_name", "unit", "monthly_rent", "company"],
		order_by="monthly_rent desc",
		limit=5,
	)

	top_tenants = []
	for t in top_tenants_raw:
		tenant_name = frappe.db.get_value("Tenant", t.party_name, "tenant_name") or t.party_name
		property_name = frappe.db.get_value("Unit", t.unit, "property") if t.unit else ""
		top_tenants.append({
			"tenant_id": t.party_name,
			"tenant_name": tenant_name,
			"unit": t.unit,
			"property": property_name,
			"monthly_rent": flt(t.monthly_rent),
			"company": t.company,
		})

	# ── 6-month revenue trend ───────────────────────────────────────────────
	trend = []
	for i in range(5, -1, -1):
		ref = add_months(today, -i)
		m_start = get_first_day(ref)
		m_end = get_last_day(ref)
		rows = frappe.db.get_all(
			"Sales Invoice",
			filters={
				**si_pms_base,
				"docstatus": 1,
				"posting_date": ["between", [m_start, m_end]],
			},
			fields=["grand_total", "outstanding_amount"],
		)
		revenue = sum(flt(r.grand_total) for r in rows)
		collected = sum(flt(r.grand_total) - flt(r.outstanding_amount) for r in rows)
		trend.append({
			"month": m_start.strftime("%b %Y"),
			"revenue": round(revenue, 2),
			"collected": round(collected, 2),
		})

	# ── Properties list with unit counts ────────────────────────────────────
	properties = frappe.db.get_all(
		"Property",
		filters={"name": ["in", prop_names]} if prop_names else {"name": "__DOES_NOT_EXIST__"},
		fields=["name", "property_name"],
		limit=500,
	)
	property_stats = []
	for p in properties:
		p_units = frappe.db.get_all(
			"Unit",
			filters={"property": p.name},
			fields=["status"],
		)
		p_total = len(p_units)
		p_occupied = sum(1 for u in p_units if u.status == "Occupied")
		property_stats.append({
			"name": p.name,
			"property_name": p.get("property_name") or p.name,
			"total_units": p_total,
			"occupied": p_occupied,
			"vacant": p_total - p_occupied,
		})

	return {
		"total_properties": total_properties,
		"total_units": total_units,
		"occupied_units": occupied,
		"vacant_units": vacant,
		"occupancy_rate": occupancy_rate,
		"active_contracts": active_contracts,
		"total_contracts": total_contracts,
		"expired_contracts": expired_contracts,
		"terminated_contracts": terminated_contracts,
		"expiring_soon": expiring_soon,
		"monthly_revenue": round(monthly_revenue, 2),
		"monthly_paid": round(monthly_paid, 2),
		"total_outstanding": round(total_outstanding, 2),
		"lease_status": lease_status,
		"top_tenants": top_tenants,
		"revenue_trend": trend,
		"property_stats": property_stats,
	}


# ─────────────────────────────────────────────────────────────────────────────
#  FINANCIAL OVERVIEW
# ─────────────────────────────────────────────────────────────────────────────

@frappe.whitelist()
def get_financial_overview(month=None, year=None, company=None):
	"""
	Return per-unit financial status for a given month/year.
	Each record contains:
	  unit, property, tenant, monthly_rent,
	  invoiced (this month), paid, outstanding, overdue_amount,
	  status  ("paid" | "partial" | "outstanding" | "overdue" | "no_contract")

	Optional ``company``: restrict to one permitted company (omit / None for all permitted).
	"""
	today = getdate(nowdate())
	if month and year:
		ref = date(int(year), int(month), 1)
	else:
		ref = today
	m_start = get_first_day(ref)
	m_end = get_last_day(ref)

	companies = _pms_effective_companies(company or None)
	if not companies:
		return []

	# All active (and recently expired) contracts for context
	contracts = frappe.db.get_all(
		"Tenant Contract",
		filters={
			"docstatus": 1,
			"status": ["in", ["Active", "Expired"]],
			"company": ["in", companies],
		},
		fields=[
			"name", "unit", "party_name", "monthly_rent",
			"company", "start_date", "end_date", "status",
		],
	)

	results = []
	for c in contracts:
		tenant_name = frappe.db.get_value("Tenant", c.party_name, "tenant_name") or c.party_name
		property_name = frappe.db.get_value("Unit", c.unit, "property") if c.unit else ""

		# Invoices for this contract in the selected month
		invoices = frappe.db.get_all(
			"Sales Invoice",
			filters={
				"custom_tenant_contract": c.name,
				"docstatus": ["!=", 2],
				"posting_date": ["between", [m_start, m_end]],
			},
			fields=["name", "grand_total", "outstanding_amount", "due_date", "docstatus"],
		)

		invoiced = sum(flt(i.grand_total) for i in invoices)
		outstanding = sum(flt(i.outstanding_amount) for i in invoices if i.docstatus == 1)
		paid = invoiced - outstanding

		# Overdue: submitted invoices past due date with outstanding > 0
		overdue = sum(
			flt(i.outstanding_amount)
			for i in invoices
			if i.docstatus == 1
			and flt(i.outstanding_amount) > 0
			and i.due_date
			and getdate(i.due_date) < today
		)

		if invoiced == 0:
			status = "no_invoice"
		elif overdue > 0:
			status = "overdue"
		elif outstanding > 0:
			status = "outstanding"
		elif outstanding == 0 and invoiced > 0:
			status = "paid"
		else:
			status = "no_invoice"

		results.append({
			"contract": c.name,
			"unit": c.unit,
			"property": property_name,
			"tenant_id": c.party_name,
			"tenant_name": tenant_name,
			"monthly_rent": flt(c.monthly_rent),
			"contract_status": c.status,
			"invoiced": round(invoiced, 2),
			"paid": round(paid, 2),
			"outstanding": round(outstanding, 2),
			"overdue": round(overdue, 2),
			"invoice_count": len(invoices),
			"status": status,
		})

	# Sort: overdue first, then outstanding, then paid
	order = {"overdue": 0, "outstanding": 1, "no_invoice": 2, "paid": 3}
	results.sort(key=lambda x: order.get(x["status"], 99))
	return results


# ─────────────────────────────────────────────────────────────────────────────
#  UNIT DETAIL
# ─────────────────────────────────────────────────────────────────────────────

@frappe.whitelist()
def get_unit_detail(unit_name, company=None):
	"""
	Return full detail for a unit's right-side panel:
	  - contract info
	  - all pending (unpaid) invoices
	  - last 10 submitted invoices (payment history)
	  - recent expenses linked to this unit/property

	Optional ``company``: must match the unit's property company when set (permission-checked).
	"""
	unit = frappe.get_doc("Unit", unit_name)
	_ensure_unit_company_allowed(unit, company or None)
	property_name = unit.property
	si_company = {"company": ["in", _pms_effective_companies(company or None)]}

	# Active contract
	contract = frappe.db.get_value(
		"Tenant Contract",
		{"unit": unit_name, "status": "Active", "docstatus": 1},
		["name", "party_name", "monthly_rent", "start_date", "end_date",
		 "company", "currency", "invoice_grouping"],
		as_dict=True,
	)

	tenant_info = None
	if contract:
		tenant_info = frappe.db.get_value(
			"Tenant",
			contract.party_name,
			["tenant_name", "email", "mobile_no", "customer"],
			as_dict=True,
		)

	# All outstanding invoices (submitted, outstanding_amount > 0)
	pending_invoices = frappe.db.get_all(
		"Sales Invoice",
		filters={
			**si_company,
			"custom_unit": unit_name,
			"docstatus": 1,
			"outstanding_amount": [">", 0],
		},
		fields=[
			"name", "posting_date", "due_date",
			"grand_total", "outstanding_amount", "custom_invoice_no",
		],
		order_by="due_date asc",
		limit=20,
	)

	# Payment history (last 10 submitted invoices)
	invoice_history = frappe.db.get_all(
		"Sales Invoice",
		filters={
			**si_company,
			"custom_unit": unit_name,
			"docstatus": 1,
		},
		fields=[
			"name", "posting_date", "due_date",
			"grand_total", "outstanding_amount", "custom_invoice_no",
		],
		order_by="posting_date desc",
		limit=10,
	)

	# Recent expenses: look for Purchase Invoices or Journal Entries linked to property
	# Fall back to cost center or project matching the unit/property
	expenses = []
	try:
		je_rows = frappe.db.sql(
			"""
			SELECT
				je.name, je.posting_date, je.total_debit as amount,
				je.user_remark as description, je.docstatus
			FROM `tabJournal Entry` je
			INNER JOIN `tabJournal Entry Account` jea ON jea.parent = je.name
			WHERE je.docstatus = 1
			AND jea.reference_type = 'Unit'
			AND jea.reference_name = %s
			GROUP BY je.name
			ORDER BY je.posting_date DESC
			LIMIT 10
			""",
			(unit_name,),
			as_dict=True,
		)
		expenses = [dict(e) for e in je_rows]
	except Exception:
		pass
	return {
		"unit": unit_name,
		"property": property_name,
		"unit_status": unit.status,
		"contract": contract,
		"tenant": tenant_info,
		"pending_invoices": [dict(i) for i in pending_invoices],
		"invoice_history": [dict(i) for i in invoice_history],
		"expenses": expenses,
	}


# ─────────────────────────────────────────────────────────────────────────────
#  PROPERTIES FINANCIAL OVERVIEW
# ─────────────────────────────────────────────────────────────────────────────

@frappe.whitelist()
def get_properties_financial(company=None):
	"""
	Return per-property financial summary:
	  name, total_units, occupied, vacant, total_monthly_rent,
	  total_outstanding, total_overdue, unit_count_by_status

	Optional ``company``: restrict to one permitted company (omit / None for all permitted).
	"""
	today = getdate(nowdate())
	companies = _pms_effective_companies(company or None)
	if not companies:
		return []

	properties = frappe.db.get_all(
		"Property",
		filters={"company": ["in", companies]},
		fields=["name", "property_name", "address_line_1", "city", "property_type", "status"],
		limit=500,
	)

	results = []
	for p in properties:
		address_parts = [p.get("address_line_1") or "", p.get("city") or ""]
		address = ", ".join(x for x in address_parts if x)

		units = frappe.db.get_all(
			"Unit",
			filters={"property": p.name},
			fields=["name", "status", "standard_rent"],
		)
		total_units   = len(units)
		occupied      = sum(1 for u in units if u.status == "Occupied")
		vacant        = total_units - occupied

		unit_names = [u.name for u in units]
		if not unit_names:
			results.append({
				"name": p.name,
				"property_name": p.get("property_name") or p.name,
				"address": address,
				"property_type": p.get("property_type", ""),
				"status": p.get("status", ""),
				"total_units": 0, "occupied": 0, "vacant": 0,
				"total_monthly_rent": 0, "total_outstanding": 0, "total_overdue": 0,
				"units": [],
			})
			continue

		# Active contracts for units in this property
		contracts = frappe.db.get_all(
			"Tenant Contract",
			filters={
				"unit": ["in", unit_names],
				"status": "Active",
				"docstatus": 1,
				"company": ["in", companies],
			},
			fields=["name", "unit", "party_name", "monthly_rent"],
		)
		total_monthly_rent = sum(flt(c.monthly_rent) for c in contracts)
		contract_map = {c.unit: c for c in contracts}

		# Outstanding invoices for this property's units
		if unit_names:
			outstanding_rows = frappe.db.get_all(
				"Sales Invoice",
				filters={
					"company": ["in", companies],
					"custom_unit": ["in", unit_names],
					"docstatus": 1,
					"outstanding_amount": [">", 0],
				},
				fields=["custom_unit", "outstanding_amount", "due_date"],
			)
		else:
			outstanding_rows = []

		total_outstanding = sum(flt(r.outstanding_amount) for r in outstanding_rows)
		total_overdue = sum(
			flt(r.outstanding_amount)
			for r in outstanding_rows
			if r.due_date and getdate(r.due_date) < today
		)

		# Build per-unit summary for the property detail view
		unit_summaries = []
		for u in units:
			u_outstanding = sum(flt(r.outstanding_amount) for r in outstanding_rows if r.custom_unit == u.name)
			u_overdue = sum(
				flt(r.outstanding_amount)
				for r in outstanding_rows
				if r.custom_unit == u.name and r.due_date and getdate(r.due_date) < today
			)
			c = contract_map.get(u.name)
			tenant_name = ""
			if c:
				tenant_name = frappe.db.get_value("Tenant", c.party_name, "tenant_name") or c.party_name
			unit_summaries.append({
				"name": u.name,
				"status": u.status,
				"tenant_name": tenant_name,
				"monthly_rent": flt(c.monthly_rent) if c else 0,
				"outstanding": round(u_outstanding, 2),
				"overdue": round(u_overdue, 2),
			})

		results.append({
			"name": p.name,
			"property_name": p.get("property_name") or p.name,
			"address": address,
			"property_type": p.get("property_type", ""),
			"status": p.get("status", ""),
			"total_units": total_units,
			"occupied": occupied,
			"vacant": vacant,
			"total_monthly_rent": round(total_monthly_rent, 2),
			"total_outstanding": round(total_outstanding, 2),
			"total_overdue": round(total_overdue, 2),
			"units": unit_summaries,
		})

	results.sort(key=lambda x: x["total_outstanding"], reverse=True)
	return results


# ─────────────────────────────────────────────────────────────────────────────
#  UNITS OVERVIEW  (for the Units tab)
# ─────────────────────────────────────────────────────────────────────────────

@frappe.whitelist()
def get_units_overview(company=None):
	"""
	Return every unit with its financial status and current tenant.

	Optional ``company``: restrict to one permitted company (omit / None for all permitted).
	"""
	today = getdate(nowdate())
	companies = _pms_effective_companies(company or None)
	if not companies:
		return []

	prop_names = _property_names_for_companies(companies)
	unit_filters = {"property": ["in", prop_names]} if prop_names else {"name": "__DOES_NOT_EXIST__"}

	units = frappe.db.get_all(
		"Unit",
		fields=["name", "property", "status", "standard_rent", "area", "floor"],
		filters=unit_filters,
		limit=2000,
	)

	# Batch-fetch active contracts
	contracts = frappe.db.get_all(
		"Tenant Contract",
		filters={"status": "Active", "docstatus": 1, "company": ["in", companies]},
		fields=["name", "unit", "party_name", "monthly_rent", "start_date", "end_date", "company"],
	)
	contract_map = {c.unit: c for c in contracts}

	# Batch-fetch all outstanding invoices
	outstanding_rows = frappe.db.get_all(
		"Sales Invoice",
		filters={
			"company": ["in", companies],
			"docstatus": 1,
			"outstanding_amount": [">", 0],
		},
		fields=["custom_unit", "outstanding_amount", "due_date"],
	) if units else []
	outstanding_by_unit: dict = {}
	for r in outstanding_rows:
		k = r.custom_unit or ""
		if k:
			outstanding_by_unit.setdefault(k, []).append(r)

	results = []
	for u in units:
		c = contract_map.get(u.name)
		tenant_name = ""
		if c:
			tenant_name = frappe.db.get_value("Tenant", c.party_name, "tenant_name") or c.party_name

		rows = outstanding_by_unit.get(u.name, [])
		outstanding = sum(flt(r.outstanding_amount) for r in rows)
		overdue = sum(
			flt(r.outstanding_amount)
			for r in rows
			if r.due_date and getdate(r.due_date) < today
		)

		if outstanding == 0:
			pay_status = "paid"
		elif overdue > 0:
			pay_status = "overdue"
		else:
			pay_status = "outstanding"

		if u.status != "Occupied":
			pay_status = "vacant"

		results.append({
			"unit": u.name,
			"property": u.property or "",
			"unit_status": u.status,
			"area": str(u.get("area") or ""),
			"floor": str(u.get("floor") or ""),
			"tenant_name": tenant_name,
			"tenant_id": c.party_name if c else "",
			"monthly_rent": flt(c.monthly_rent) if c else 0,
			"outstanding": round(outstanding, 2),
			"overdue": round(overdue, 2),
			"pay_status": pay_status,
			"contract": c.name if c else "",
			"contract_start": str(c.start_date) if c else "",
			"contract_end": str(c.end_date) if c else "",
		})

	results.sort(key=lambda x: (
		0 if x["pay_status"] == "overdue" else
		1 if x["pay_status"] == "outstanding" else
		2 if x["pay_status"] == "paid" else 3,
		x["unit"]
	))
	return results


# ─────────────────────────────────────────────────────────────────────────────
#  UNIT MONTH BREAKDOWN  (12-month payment history for a unit)
# ─────────────────────────────────────────────────────────────────────────────

@frappe.whitelist()
def get_unit_month_breakdown(unit_name, company=None):
	"""
	Return a 12-month payment breakdown for a single unit.
	Each entry: month_label, month_start, invoiced, paid, outstanding, status

	Optional ``company``: must match the unit's property company when set (permission-checked).
	"""
	unit = frappe.get_doc("Unit", unit_name)
	_ensure_unit_company_allowed(unit, company or None)
	today = getdate(nowdate())
	si_company = {"company": ["in", _pms_effective_companies(company or None)]}
	breakdown = []

	for i in range(11, -1, -1):
		ref = add_months(today, -i)
		m_start = get_first_day(ref)
		m_end   = get_last_day(ref)

		invoices = frappe.db.get_all(
			"Sales Invoice",
			filters={
				**si_company,
				"custom_unit": unit_name,
				"docstatus": ["!=", 2],
				"posting_date": ["between", [m_start, m_end]],
			},
			fields=["name", "grand_total", "outstanding_amount", "docstatus", "due_date"],
		)

		invoiced    = sum(flt(inv.grand_total) for inv in invoices if inv.docstatus == 1)
		outstanding = sum(flt(inv.outstanding_amount) for inv in invoices if inv.docstatus == 1)
		paid        = invoiced - outstanding

		if invoiced == 0:
			status = "no_invoice"
		elif outstanding == 0:
			status = "paid"
		else:
			# Check if overdue
			is_overdue = any(
				inv.due_date and getdate(inv.due_date) < today and flt(inv.outstanding_amount) > 0
				for inv in invoices if inv.docstatus == 1
			)
			status = "overdue" if is_overdue else "outstanding"

		breakdown.append({
			"month_label": m_start.strftime("%b %Y"),
			"month_short": m_start.strftime("%b"),
			"year": m_start.year,
			"is_current": (m_start.year == today.year and m_start.month == today.month),
			"invoiced": round(invoiced, 2),
			"paid": round(paid, 2),
			"outstanding": round(outstanding, 2),
			"status": status,
			"invoice_count": len([inv for inv in invoices if inv.docstatus == 1]),
		})

	return breakdown

@frappe.whitelist()
def get_available_months():
	"""Return last 12 year-month pairs that have at least one PMS invoice."""
	today = getdate(nowdate())
	months = []
	for i in range(11, -1, -1):
		ref = add_months(today, -i)
		months.append({
			"value": f"{ref.year}-{ref.month:02d}",
			"label": ref.strftime("%B %Y"),
			"month": ref.month,
			"year": ref.year,
		})
	return months


@frappe.whitelist()
def get_tenant_contracts_dashboard(company=None):
	"""Submitted Tenant Contracts for the dashboard Tenant Contract tab (filter client-side)."""
	today = getdate(nowdate())
	expiry_cutoff = add_days(today, 30)
	companies = _pms_effective_companies(company or None)
	if not companies:
		return []

	rows = frappe.db.get_all(
		"Tenant Contract",
		filters={"docstatus": 1, "company": ["in", companies]},
		fields=[
			"name",
			"status",
			"party_name",
			"unit",
			"property",
			"monthly_rent",
			"start_date",
			"end_date",
			"company",
		],
		order_by="modified desc",
		limit=500,
	)

	out = []
	for r in rows:
		tenant_label = frappe.db.get_value("Tenant", r.party_name, "tenant_name") or r.party_name or ""
		prop_display = ""
		if r.get("property"):
			prop_display = frappe.db.get_value("Property", r.property, "property_name") or r.property

		end_d = getdate(r.end_date) if r.end_date else None
		expiring_soon = (
			r.status == "Active"
			and end_d is not None
			and today <= end_d <= expiry_cutoff
		)

		out.append({
			"name": r.name,
			"status": r.status or "",
			"tenant_name": tenant_label,
			"party_name": r.party_name or "",
			"unit": r.unit or "",
			"property": prop_display or "",
			"monthly_rent": flt(r.monthly_rent),
			"start_date": str(r.start_date) if r.start_date else "",
			"end_date": str(r.end_date) if r.end_date else "",
			"company": r.company or "",
			"expiring_soon": expiring_soon,
		})

	return out
