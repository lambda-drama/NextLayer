"""
wage_report.py
--------------
Whitelisted API endpoints powering the Wage Entry Report UI.
"""

import frappe
from frappe import _
from frappe.utils import flt, getdate, nowdate, add_days, cint


# ─────────────────────────────────────────────────────────────────────────────
#  COMPANY PERMISSION (aligned with general_ledger.get_permission_aware_companies)
# ─────────────────────────────────────────────────────────────────────────────

def _allowed_company_rows():
	"""Company rows (name, company_name) the current user may use for Wage Entry."""
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


def _company_filters_for_query(requested_company=None):
	"""
	Restrict Wage Entry queries to companies the user may access.
	If requested_company is set, validate and filter to that company only.
	If not set, restrict to ["in", allowed companies].
	"""
	allowed = _allowed_company_names()
	if not allowed:
		return {"company": "__DOES_NOT_EXIST__"}

	if requested_company:
		_ensure_company_allowed(requested_company)
		return {"company": requested_company}

	return {"company": ["in", sorted(allowed)]}


def _fmt_date(d):
	return str(d) if d else ""

def _checkout_tracking_by_entry(entry_names):
	"""
	Build checkout tracking flags per Wage Entry:
	- legacy rows (no checkin recorded): checkout_state = "legacy"
	- tracked rows with all checkins checked out: checkout_state = "checked_out"
	- tracked rows with any missing checkout: checkout_state = "not_checked_out"
	"""
	if not entry_names:
		return {}

	rows = frappe.db.sql(
		"""
		SELECT
			parent,
			SUM(CASE WHEN checkin IS NOT NULL THEN 1 ELSE 0 END) AS checkin_count,
			SUM(CASE WHEN checkin IS NOT NULL AND checkout IS NULL THEN 1 ELSE 0 END) AS missing_checkout_count
		FROM `tabWage Breakdown Detail`
		WHERE parenttype='Wage Entry' AND parent IN %(parents)s
		GROUP BY parent
		""",
		{"parents": tuple(entry_names)},
		as_dict=True,
	)

	tracking_map = {}
	for r in rows:
		has_checkin = int(r.get("checkin_count") or 0) > 0
		has_pending_checkout = int(r.get("missing_checkout_count") or 0) > 0
		if not has_checkin:
			state = "legacy"
		elif has_pending_checkout:
			state = "not_checked_out"
		else:
			state = "checked_out"
		tracking_map[r.parent] = {
			"has_checkin_tracking": has_checkin,
			"has_pending_checkout": has_pending_checkout,
			"checkout_state": state,
		}
	return tracking_map

def _pending_checkout_entry_names():
	"""Distinct Wage Entry names that have checkin and missing checkout."""
	rows = frappe.db.sql(
		"""
		SELECT DISTINCT parent
		FROM `tabWage Breakdown Detail`
		WHERE parenttype='Wage Entry' AND checkin IS NOT NULL AND checkout IS NULL
		""",
		as_dict=True,
	)
	return [r.parent for r in rows if r.get("parent")]


# ─────────────────────────────────────────────────────────────────────────────
#  SUMMARY KPIs
# ─────────────────────────────────────────────────────────────────────────────

@frappe.whitelist()
def get_wage_summary(project=None, date_from=None, date_to=None, status=None, company=None, pending_checkout=0):
	"""
	Return top-level KPIs for the wage entry dashboard:
	  total_entries, total_amount, total_workers, unique_projects,
	  today_entries, today_amount, draft_count, submitted_count
	"""
	today = getdate(nowdate())
	filters = {"docstatus": ["!=", 2]}
	filters.update(_company_filters_for_query(company or None))
	if project:
		filters["project"] = project
	if status:
		filters["status"] = status
	if date_from:
		filters["date"] = [">=", date_from]
	if date_to:
		date_filter = filters.get("date")
		if date_filter:
			filters["date"] = ["between", [date_from, date_to]]
		else:
			filters["date"] = ["<=", date_to]
	if cint(pending_checkout):
		pending_names = _pending_checkout_entry_names()
		if pending_names:
			filters["name"] = ["in", pending_names]
		else:
			filters["name"] = "__NO_PENDING_CHECKOUT__"

	entries = frappe.db.get_all(
		"Wage Entry",
		filters=filters,
		fields=["name", "date", "total_amount", "total_qty", "project", "docstatus"],
	)

	total_entries    = len(entries)
	total_amount     = sum(flt(e.total_amount) for e in entries)
	total_workers    = sum(flt(e.total_qty) for e in entries)
	unique_projects  = len(set(e.project for e in entries if e.project))
	submitted_count  = sum(1 for e in entries if e.docstatus == 1)
	draft_count      = sum(1 for e in entries if e.docstatus == 0)

	today_entries = [e for e in entries if e.date and getdate(e.date) == today]
	today_count  = len(today_entries)
	today_amount = sum(flt(e.total_amount) for e in today_entries)

	return {
		"total_entries": total_entries,
		"total_amount": round(total_amount, 2),
		"total_workers": int(total_workers),
		"unique_projects": unique_projects,
		"submitted_count": submitted_count,
		"draft_count": draft_count,
		"today_count": today_count,
		"today_amount": round(today_amount, 2),
	}


# ─────────────────────────────────────────────────────────────────────────────
#  WAGE ENTRIES LIST
# ─────────────────────────────────────────────────────────────────────────────

@frappe.whitelist()
def get_wage_entries(project=None, date_from=None, date_to=None, status=None, company=None, limit=200, pending_checkout=0):
	"""
	Return list of wage entries with core fields for the table view.
	"""
	filters = {"docstatus": ["!=", 2]}
	filters.update(_company_filters_for_query(company or None))
	if project:
		filters["project"] = project
	if status:
		filters["status"] = status
	if date_from and date_to:
		filters["date"] = ["between", [date_from, date_to]]
	elif date_from:
		filters["date"] = [">=", date_from]
	elif date_to:
		filters["date"] = ["<=", date_to]
	if cint(pending_checkout):
		pending_names = _pending_checkout_entry_names()
		if pending_names:
			filters["name"] = ["in", pending_names]
		else:
			filters["name"] = "__NO_PENDING_CHECKOUT__"

	entries = frappe.db.get_all(
		"Wage Entry",
		filters=filters,
		fields=[
			"name", "date", "wage_type", "start_date", "end_date",
			"project", "stage", "company", "currency",
			"total_qty", "total_amount", "docstatus", "status",
			"description", "wage_category", "average_working_hours",
			"party_type", "party",
		],
		order_by="date desc, name desc",
		limit=int(limit),
	)

	result = []
	checkout_tracking = _checkout_tracking_by_entry([e.name for e in entries])
	for e in entries:
		status_label = {0: "Draft", 1: "Submitted", 2: "Cancelled"}.get(e.docstatus, "Draft")
		if e.status:
			status_label = e.status
		tracking = checkout_tracking.get(e.name, {
			"has_checkin_tracking": False,
			"has_pending_checkout": False,
			"checkout_state": "legacy",
		})
		result.append({
			"name": e.name,
			"date": _fmt_date(e.date),
			"wage_type": e.wage_type or "",
			"start_date": _fmt_date(e.start_date),
			"end_date": _fmt_date(e.end_date),
			"project": e.project or "",
			"stage": e.stage or "",
			"company": e.company or "",
			"currency": e.currency or "USD",
			"total_qty": int(flt(e.total_qty)),
			"total_amount": round(flt(e.total_amount), 2),
			"docstatus": e.docstatus,
			"status_label": status_label,
			"description": e.description or "",
			"wage_category": e.wage_category or "",
			"average_working_hours": flt(e.average_working_hours),
			"has_checkin_tracking": tracking["has_checkin_tracking"],
			"has_pending_checkout": tracking["has_pending_checkout"],
			"checkout_state": tracking["checkout_state"],
		})

	return result


# ─────────────────────────────────────────────────────────────────────────────
#  WAGE ENTRY DETAIL  (breakdown rows)
# ─────────────────────────────────────────────────────────────────────────────

@frappe.whitelist()
def get_wage_entry_detail(name):
	"""
	Return full breakdown for a single Wage Entry:
	  - header fields
	  - wages child table (per-worker: name, check-in/out, type_of_work, qty, amount, phone)
	  - type_of_work_breakdown child table (summary by work type)
	"""
	doc = frappe.get_doc("Wage Entry", name)
	_ensure_company_allowed(doc.company)

	wages = []
	for row in doc.wages or []:
		wages.append({
			"idx": row.idx,
			"type_of_work": row.type_of_work or "",
			"name1": row.name1 or "",
			"rate": flt(row.rate),
			"qty": flt(row.qty),
			"amount": round(flt(row.amount), 2),
			"checkin": str(row.checkin) if row.checkin else "",
			"checkout": str(row.checkout) if row.checkout else "",
			"phone_no": row.phone_no or "",
			"description": row.description or "",
			"daily_wage": flt(row.daily_wage),
			"duration": flt(row.duration),
		})

	work_breakdown = []
	for row in (doc.type_of_work_breakdown or []):
		work_breakdown.append({
			"type_of_work": row.type_of_work or "",
			"no_of_workers": int(flt(row.no_of_workers)),
			"total_qty": flt(row.total_qty),
			"total_amount": round(flt(row.total_amount), 2),
			"daily_wage": flt(row.daily_wage),
		})

	return {
		"name": doc.name,
		"date": _fmt_date(doc.date),
		"wage_type": doc.wage_type or "",
		"start_date": _fmt_date(doc.start_date),
		"end_date": _fmt_date(doc.end_date),
		"project": doc.project or "",
		"stage": doc.stage or "",
		"company": doc.company or "",
		"currency": doc.currency or "USD",
		"total_qty": int(flt(doc.total_qty)),
		"total_amount": round(flt(doc.total_amount), 2),
		"docstatus": doc.docstatus,
		"description": doc.description or "",
		"default_expense_account": doc.default_expense_account or "",
		"default_payable_account": doc.default_payable_account or "",
		"wage_category": doc.wage_category or "",
		"average_working_hours": flt(doc.average_working_hours),
		"wages": wages,
		"work_breakdown": work_breakdown,
	}


# ─────────────────────────────────────────────────────────────────────────────
#  FILTER OPTIONS
# ─────────────────────────────────────────────────────────────────────────────

@frappe.whitelist()
def get_wage_filter_options():
	"""Companies respect User Permissions on Company (same idea as ledger summary). Projects load via get_wage_projects_for_company."""
	rows = _allowed_company_rows()
	return {
		"projects": [],
		"companies": [{"value": r.name, "label": r.get("company_name") or r.name} for r in rows],
		"statuses": [
			{"value": "Draft",     "label": "Draft"},
			{"value": "Submitted", "label": "Submitted"},
		],
	}


@frappe.whitelist()
def get_wage_projects_for_company(company=None):
	"""Projects for the selected company only (must be allowed for current user)."""
	if not company:
		return []
	_ensure_company_allowed(company)
	projects = frappe.db.get_all(
		"Project",
		fields=["name", "project_name"],
		filters={"company": company, "status": ["!=", "Cancelled"]},
		order_by="project_name",
		limit=500,
	)
	return [{"value": p.name, "label": p.get("project_name") or p.name} for p in projects]


# ─────────────────────────────────────────────────────────────────────────────
#  TREND: daily total_amount for last 30 days
# ─────────────────────────────────────────────────────────────────────────────

@frappe.whitelist()
def get_wage_trend(project=None, company=None, days=30):
	"""Return daily wage totals for the last N days (bar chart data)."""
	today = getdate(nowdate())
	date_from = add_days(today, -int(days) + 1)

	filters = {"docstatus": 1, "date": ["between", [date_from, today]]}
	filters.update(_company_filters_for_query(company or None))
	if project:
		filters["project"] = project

	rows = frappe.db.get_all(
		"Wage Entry",
		filters=filters,
		fields=["date", "total_amount", "total_qty"],
		order_by="date asc",
	)

	# Aggregate by date
	by_date: dict = {}
	for r in rows:
		d = str(r.date)
		if d not in by_date:
			by_date[d] = {"date": d, "amount": 0, "workers": 0}
		by_date[d]["amount"]  += flt(r.total_amount)
		by_date[d]["workers"] += int(flt(r.total_qty))

	result = []
	cur = date_from
	while cur <= today:
		d = str(cur)
		entry = by_date.get(d, {"date": d, "amount": 0, "workers": 0})
		entry["date_label"] = getdate(cur).strftime("%d %b")
		result.append(entry)
		cur = add_days(cur, 1)

	return result
