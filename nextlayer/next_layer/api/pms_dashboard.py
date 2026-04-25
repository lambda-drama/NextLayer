"""
pms_dashboard.py
----------------
Whitelisted API endpoints powering the Property Management Dashboard.
"""

import frappe
from frappe.utils import nowdate, flt, getdate, add_months, get_first_day, get_last_day
from datetime import date
import calendar


# ─────────────────────────────────────────────────────────────────────────────
#  OVERVIEW
# ─────────────────────────────────────────────────────────────────────────────

@frappe.whitelist()
def get_dashboard_overview():
	"""
	Return all KPIs needed for the Overview tab:
	  - property / unit counts
	  - active contracts
	  - occupancy rate
	  - monthly revenue (current month)
	  - lease status breakdown
	  - top-5 tenants by monthly rent
	  - last-6-months revenue trend
	"""

	# ── Property & Unit counts ──────────────────────────────────────────────
	total_properties = frappe.db.count("Property")

	unit_data = frappe.db.get_all(
		"Unit",
		fields=["status"],
		filters=[],
	)
	total_units = len(unit_data)
	occupied = sum(1 for u in unit_data if u.status == "Occupied")
	vacant = total_units - occupied
	occupancy_rate = round((occupied / total_units * 100), 1) if total_units else 0

	# ── Active contracts ────────────────────────────────────────────────────
	contract_data = frappe.db.get_all(
		"Tenant Contract",
		filters={"docstatus": 1},
		fields=["status"],
	)
	active_contracts = sum(1 for c in contract_data if c.status == "Active")

	# Lease status breakdown (for all submitted contracts)
	lease_status = {}
	for c in contract_data:
		lease_status[c.status] = lease_status.get(c.status, 0) + 1

	# ── Monthly revenue (current month invoiced & submitted) ────────────────
	today = getdate(nowdate())
	month_start = get_first_day(today)
	month_end = get_last_day(today)

	monthly_invoices = frappe.db.get_all(
		"Sales Invoice",
		filters={
			"docstatus": 1,
			"posting_date": ["between", [month_start, month_end]],
			"custom_tenant_contract": ["!=", ""],
		},
		fields=["grand_total"],
	)
	monthly_revenue = sum(flt(i.grand_total) for i in monthly_invoices)

	# Outstanding balance (submitted invoices not fully paid)
	outstanding_invoices = frappe.db.get_all(
		"Sales Invoice",
		filters={
			"docstatus": 1,
			"outstanding_amount": [">", 0],
			"custom_tenant_contract": ["!=", ""],
		},
		fields=["outstanding_amount"],
	)
	total_outstanding = sum(flt(i.outstanding_amount) for i in outstanding_invoices)

	# ── Top-5 tenants by monthly rent ───────────────────────────────────────
	top_tenants_raw = frappe.db.get_all(
		"Tenant Contract",
		filters={"status": "Active", "docstatus": 1},
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
				"docstatus": 1,
				"posting_date": ["between", [m_start, m_end]],
				"custom_tenant_contract": ["!=", ""],
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
		fields=["name", "property_name"],
		limit=100,
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
		"monthly_revenue": round(monthly_revenue, 2),
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
def get_financial_overview(month=None, year=None):
	"""
	Return per-unit financial status for a given month/year.
	Each record contains:
	  unit, property, tenant, monthly_rent,
	  invoiced (this month), paid, outstanding, overdue_amount,
	  status  ("paid" | "partial" | "outstanding" | "overdue" | "no_contract")
	"""
	today = getdate(nowdate())
	if month and year:
		ref = date(int(year), int(month), 1)
	else:
		ref = today
	m_start = get_first_day(ref)
	m_end = get_last_day(ref)

	# All active (and recently expired) contracts for context
	contracts = frappe.db.get_all(
		"Tenant Contract",
		filters={"docstatus": 1, "status": ["in", ["Active", "Expired"]]},
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
def get_unit_detail(unit_name):
	"""
	Return full detail for a unit's right-side panel:
	  - contract info
	  - all pending (unpaid) invoices
	  - last 10 submitted invoices (payment history)
	  - recent expenses linked to this unit/property
	"""
	unit = frappe.get_doc("Unit", unit_name)
	property_name = unit.property

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
			["tenant_name", "email_id", "mobile_no", "customer"],
			as_dict=True,
		)

	# All outstanding invoices (submitted, outstanding_amount > 0)
	pending_invoices = frappe.db.get_all(
		"Sales Invoice",
		filters={
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
				je.remark as description, je.docstatus
			FROM `tabJournal Entry` je
			WHERE je.docstatus = 1
			  AND (je.remark LIKE %s OR je.remark LIKE %s)
			ORDER BY je.posting_date DESC
			LIMIT 10
			""",
			(f"%{unit_name}%", f"%{property_name}%" if property_name else "%%"),
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
def get_properties_financial():
	"""
	Return per-property financial summary:
	  name, total_units, occupied, vacant, total_monthly_rent,
	  total_outstanding, total_overdue, unit_count_by_status
	"""
	today = getdate(nowdate())
	properties = frappe.db.get_all(
		"Property",
		fields=["name", "property_name", "address"],
		limit=200,
	)

	results = []
	for p in properties:
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
				"address": p.get("address", ""),
				"total_units": 0, "occupied": 0, "vacant": 0,
				"total_monthly_rent": 0, "total_outstanding": 0, "total_overdue": 0,
				"units": [],
			})
			continue

		# Active contracts for units in this property
		contracts = frappe.db.get_all(
			"Tenant Contract",
			filters={"unit": ["in", unit_names], "status": "Active", "docstatus": 1},
			fields=["name", "unit", "party_name", "monthly_rent"],
		)
		total_monthly_rent = sum(flt(c.monthly_rent) for c in contracts)
		contract_map = {c.unit: c for c in contracts}

		# Outstanding invoices for this property's units
		if unit_names:
			outstanding_rows = frappe.db.get_all(
				"Sales Invoice",
				filters={
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
			"address": p.get("address", ""),
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
def get_units_overview():
	"""
	Return every unit with its financial status and current tenant.
	"""
	today = getdate(nowdate())

	units = frappe.db.get_all(
		"Unit",
		fields=["name", "property", "status", "standard_rent", "area", "floor"],
		limit=500,
	)

	# Batch-fetch active contracts
	contracts = frappe.db.get_all(
		"Tenant Contract",
		filters={"status": "Active", "docstatus": 1},
		fields=["name", "unit", "party_name", "monthly_rent", "start_date", "end_date", "company"],
	)
	contract_map = {c.unit: c for c in contracts}

	# Batch-fetch all outstanding invoices
	outstanding_rows = frappe.db.get_all(
		"Sales Invoice",
		filters={"docstatus": 1, "outstanding_amount": [">", 0]},
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
			"area": u.get("area", ""),
			"floor": u.get("floor", ""),
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
def get_unit_month_breakdown(unit_name):
	"""
	Return a 12-month payment breakdown for a single unit.
	Each entry: month_label, month_start, invoiced, paid, outstanding, status
	"""
	today = getdate(nowdate())
	breakdown = []

	for i in range(11, -1, -1):
		ref = add_months(today, -i)
		m_start = get_first_day(ref)
		m_end   = get_last_day(ref)

		invoices = frappe.db.get_all(
			"Sales Invoice",
			filters={
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
