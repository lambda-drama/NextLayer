"""
utility_billing.py
------------------
Reusable helpers for scheduled and on-demand utility billing.

Primary entry-point for the monthly scheduler: process_monthly_utility_billing()
"""

import calendar
import frappe
from frappe.utils import nowdate, flt, getdate, add_days


# ──────────────────────────────────────────
#  PUBLIC API
# ──────────────────────────────────────────

def process_monthly_utility_billing():
	"""
	Monthly scheduler job.
	Iterates every active Utility Meter, calculates consumption and generates
	a Sales Invoice if consumption exists (or if PMS Settings allow zero-consumption invoices).
	"""
	settings = get_pms_settings()
	meters = frappe.get_all("Utility Meter", filters={"status": "Active"}, fields=["name"])

	for row in meters:
		try:
			process_meter_billing(row.name, settings)
		except Exception:
			frappe.log_error(frappe.get_traceback(), f"Monthly billing error – meter {row.name}")

		frappe.db.commit()


def process_meter_billing(meter_name, settings=None):
	"""
	Attempt to generate a utility invoice for a single meter.

	Returns the name of the created Sales Invoice, or None if skipped.
	"""
	if settings is None:
		settings = get_pms_settings()

	meter = frappe.get_doc("Utility Meter", meter_name)

	if not meter.current_reading:
		return None

	last = flt(meter.last_reading or 0)
	consumption = flt(meter.current_reading) - last

	if consumption < 0:
		frappe.log_error(
			f"Negative consumption for meter {meter.meter_id}: "
			f"last={last}, current={meter.current_reading}",
			"Utility Billing – Negative Consumption",
		)
		return None

	generate_zero = settings.generate_invoice_for_zero_consumption if settings else 0
	if consumption == 0 and not generate_zero:
		return None

	amount = consumption * flt(meter.tariff_rate)
	invoice_name = create_utility_invoice(meter, consumption, amount, settings)

	if invoice_name:
		_create_reading_log(meter, consumption, amount, invoice_name)
		meter.db_set({
			"last_reading": meter.current_reading,
			"last_reading_date": meter.current_reading_date or nowdate(),
			"current_reading": 0,
			"current_reading_date": None,
			"last_invoice_date": nowdate(),
			"last_invoice_amount": amount,
		})

	return invoice_name


def create_utility_invoice(meter_or_name, consumption, amount, settings=None):
	"""
	Create and submit a Sales Invoice for utility consumption.

	Args:
		meter_or_name: Utility Meter document or its name (str)
		consumption:   Calculated consumption (float)
		amount:        Total billed amount (float)
		settings:      PMS Settings doc or None

	Returns:
		str: Name of the created Sales Invoice, or None on failure.
	"""
	if settings is None:
		settings = get_pms_settings()

	meter = (
		meter_or_name
		if hasattr(meter_or_name, "unit")
		else frappe.get_doc("Utility Meter", meter_or_name)
	)

	if not meter.unit:
		frappe.log_error(f"Meter {meter.meter_id} has no unit linked.", "Utility Billing")
		return None

	unit_doc = frappe.get_doc("Unit", meter.unit)
	if not unit_doc.current_tenant:
		frappe.log_error(
			f"Unit {meter.unit} has no current tenant.", "Utility Billing"
		)
		return None

	customer = frappe.db.get_value("Tenant", unit_doc.current_tenant, "customer")
	if not customer:
		frappe.log_error(
			f"Tenant {unit_doc.current_tenant} has no linked Customer.", "Utility Billing"
		)
		return None

	item_code = get_utility_item_code(meter.meter_type)
	if not item_code:
		frappe.log_error(
			f"Meter Type '{meter.meter_type}' has no linked ERPNext Item.", "Utility Billing"
		)
		return None

	income_account = settings.default_utility_income_account if settings else None
	cost_center = settings.cost_center if settings else None
	company = _get_company_for_unit(meter.unit)

	item = {
		"item_code": item_code,
		"qty": consumption,
		"rate": meter.tariff_rate,
		"description": (
			f"{meter.meter_type} consumption for {meter.unit} – "
			f"{meter.current_reading_date or nowdate()}"
		),
		"uom": meter.uom or "Nos",
	}
	if income_account:
		item["income_account"] = income_account
	if cost_center:
		item["cost_center"] = cost_center

	invoice_data = {
		"doctype": "Sales Invoice",
		"customer": customer,
		"posting_date": nowdate(),
		"due_date": get_due_date(settings),
		"items": [item],
	}
	if company:
		invoice_data["company"] = company

	try:
		invoice = frappe.get_doc(invoice_data)
		invoice.insert(ignore_permissions=True)
		invoice.submit()
	except Exception:
		frappe.log_error(frappe.get_traceback(), f"Invoice creation failed – meter {meter.meter_id}")
		return None

	if settings and settings.send_invoice_automatically:
		try:
			invoice.send_emails()
		except Exception:
			pass

	return invoice.name


# ──────────────────────────────────────────
#  HELPERS
# ──────────────────────────────────────────

def get_utility_item_code(meter_type):
	"""
	Resolve the ERPNext Item code for a given Meter Type name.

	Returns None (not raises) so callers can log and skip gracefully.
	"""
	return frappe.db.get_value("Meter Type", meter_type, "item")


def get_due_date(settings=None):
	"""
	Return a due date based on PMS Settings rent_due_day.
	Falls back to 15 days from today if not configured.
	"""
	if settings and getattr(settings, "rent_due_day", None):
		due_day = int(settings.rent_due_day)
		today = getdate(nowdate())
		max_day = calendar.monthrange(today.year, today.month)[1]
		due_day = min(due_day, max_day)

		if today.day <= due_day:
			return today.replace(day=due_day)

		if today.month == 12:
			return today.replace(year=today.year + 1, month=1, day=min(due_day, 31))

		next_month = today.month + 1
		return today.replace(
			month=next_month,
			day=min(due_day, calendar.monthrange(today.year, next_month)[1]),
		)

	return add_days(nowdate(), 15)


def get_pms_settings():
	"""Safely fetch PMS Settings single doc. Returns None on any error."""
	try:
		return frappe.get_single("PMS Settings")
	except Exception:
		return None


def get_deposit_settings_for_company(company):
	"""
	Return the per-company deposit settings row from PMS Settings,
	or fall back to global defaults.

	Returns a dict with keys:
	  deposit_liability_account, security_deposit_months,
	  deposit_interest_rate, require_move_inspection
	"""
	settings = get_pms_settings()
	if not settings:
		return {}

	# Per-company row
	for row in (settings.company_deposit_settings or []):
		if row.company == company:
			return {
				"deposit_liability_account": row.deposit_liability_account,
				"security_deposit_months": row.security_deposit_months or 1,
				"deposit_interest_rate": flt(row.deposit_interest_rate),
				"require_move_inspection": row.require_move_inspection,
			}

	# Global defaults
	return {
		"deposit_liability_account": settings.default_deposit_liability_account,
		"security_deposit_months": settings.default_security_deposit_months or 1,
		"deposit_interest_rate": flt(settings.deposit_interest_rate),
		"require_move_inspection": settings.require_move_inspection_for_deposit,
	}


# ──────────────────────────────────────────
#  PRIVATE HELPERS
# ──────────────────────────────────────────

def _get_company_for_unit(unit_name):
	"""Look up the company of the active Tenant Contract for a unit."""
	return frappe.db.get_value(
		"Tenant Contract",
		{"unit": unit_name, "status": "Active"},
		"company",
	)


def _create_reading_log(meter, consumption, amount, invoice_name=None):
	"""Create a Meter Reading Log audit record (non-fatal if it fails)."""
	period_start = (
		meter.last_reading_date
		or meter.installation_date
		or f"{nowdate()[:8]}01"
	)
	period_end = meter.current_reading_date or nowdate()

	try:
		log = frappe.get_doc({
			"doctype": "Meter Reading Log",
			"naming_series": "MRL-.YYYY.-.####",
			"meter": meter.name,
			"meter_id": meter.meter_id,
			"meter_type": meter.meter_type,
			"unit": meter.unit,
			"property": meter.property,
			"period_start": period_start,
			"period_end": period_end,
			"previous_reading": meter.last_reading,
			"current_reading": meter.current_reading,
			"consumption": consumption,
			"uom": meter.uom,
			"tariff_rate": meter.tariff_rate,
			"invoice_amount": amount,
			"invoice": invoice_name,
			"is_estimated": meter.estimated_consumption or 0,
			"notes": f"Auto-generated from monthly billing on {nowdate()}",
		})
		log.insert(ignore_permissions=True)
		return log.name
	except Exception:
		frappe.log_error(frappe.get_traceback(), "Meter Reading Log creation failed")
		return None
