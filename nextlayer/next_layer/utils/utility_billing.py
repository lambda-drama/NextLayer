"""
utility_billing.py
------------------
Central billing engine for the PMS module.

Two main scheduler / on-demand entry-points
===========================================
process_monthly_invoices()
    Iterates ALL active Tenant Contracts on the configured invoice_generation_day
    and calls contract.generate_sales_invoice() – the EXACT same code path as
    pressing the "Generate Sales Invoice" button on a contract.

process_monthly_utility_billing()
    Iterates standalone active Utility Meters (those NOT already covered by a
    contract run this month) and creates individual utility invoices.

Shared helpers used by TenantContract and this module
=====================================================
get_pms_settings()
get_due_date(settings, contract)
get_utility_item_code(meter_type)
generate_invoice_number_for_company(company)
create_reading_log(meter, consumption, amount, invoice_name)
get_deposit_settings_for_company(company)
"""

import calendar
import frappe
from frappe.utils import nowdate, flt, getdate, add_days

# Must match tenant_contract.py
RENT_ITEM_CODE = "RENT-CHARGES"


# ─────────────────────────────────────────────────────────────────────────────
#  ENTRY POINT 1 – Monthly contract invoicing  (same path as manual button)
# ─────────────────────────────────────────────────────────────────────────────

def process_monthly_invoices(force=True):
	"""
	Iterate every active, submitted Tenant Contract and call
	generate_sales_invoice() on each — identical to clicking the button.

	Runs only when today matches PMS Settings.invoice_generation_day,
	unless force=True (used by manual triggers / testing).

	Returns a summary dict  {processed, skipped_already_billed, errors}.
	"""
	settings = get_pms_settings()

	if not force:
		generation_day = int((settings and settings.invoice_generation_day) or 1)
		today_day = getdate(nowdate()).day
		if today_day != generation_day:
			frappe.logger().info(
				f"PMS: invoice run skipped – today is day {today_day}, "
				f"configured day is {generation_day}."
			)
			return {"processed": 0, "skipped_already_billed": 0, "errors": 0}

	contracts = frappe.get_all(
		"Tenant Contract",
		filters={"status": "Active", "docstatus": 1},
		fields=["name", "company", "unit", "party_name"],
	)

	summary = {"processed": 0, "skipped_already_billed": 0, "errors": 0}

	for row in contracts:
		try:
			if _already_invoiced_this_month(row.name, row.party_name):
				summary["skipped_already_billed"] += 1
				frappe.logger().debug(
					f"PMS: contract {row.name} already invoiced this month – skipping."
				)
				continue

			contract = frappe.get_doc("Tenant Contract", row.name)
			contract.generate_sales_invoice()
			summary["processed"] += 1
			frappe.db.commit()

		except Exception:
			summary["errors"] += 1
			frappe.log_error(
				frappe.get_traceback(),
				f"PMS Monthly Invoicing – contract {row.name}",
			)
			frappe.db.rollback()

	frappe.logger().info(
		f"PMS Monthly Invoicing complete: processed={summary['processed']}, "
		f"skipped={summary['skipped_already_billed']}, errors={summary['errors']}"
	)
	return summary


@frappe.whitelist()
def trigger_monthly_invoices():
	"""
	Whitelisted: force-run process_monthly_invoices() from a button or API call,
	bypassing the day-of-month check.
	"""
	return process_monthly_invoices(force=True)


# ─────────────────────────────────────────────────────────────────────────────
#  ENTRY POINT 2 – Standalone utility meter billing
# ─────────────────────────────────────────────────────────────────────────────

def process_monthly_utility_billing():
	"""
	Iterate every active Utility Meter and generate a standalone utility invoice.

	Skips meters whose unit was already billed via a contract invoice this month
	to avoid double-charging the tenant.
	"""
	settings = get_pms_settings()
	meters = frappe.get_all("Utility Meter", filters={"status": "Active"}, fields=["name"])

	for row in meters:
		try:
			process_meter_billing(row.name, settings)
		except Exception:
			frappe.log_error(
				frappe.get_traceback(),
				f"PMS Utility Billing – meter {row.name}",
			)
		frappe.db.commit()


def process_meter_billing(meter_name, settings=None):
	"""
	Attempt to generate a standalone utility invoice for a single meter.
	Returns the invoice name on success, None if skipped or failed.
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

	# Skip if the unit's contract was already billed through process_monthly_invoices
	if meter.unit and _unit_already_billed_this_month(meter.unit):
		frappe.logger().debug(
			f"PMS: meter {meter.meter_id} skipped – unit {meter.unit} "
			"already billed via contract this month."
		)
		return None

	amount = consumption * flt(meter.tariff_rate)
	invoice_name = _create_standalone_utility_invoice(meter, consumption, settings)

	if invoice_name:
		create_reading_log(meter, consumption, amount, invoice_name)
		meter.db_set({
			"last_reading": meter.current_reading,
			"last_reading_date": meter.current_reading_date or nowdate(),
			"current_reading": 0,
			"current_reading_date": None,
			"last_invoice_date": nowdate(),
			"last_invoice_amount": amount,
		})

	return invoice_name


# ─────────────────────────────────────────────────────────────────────────────
#  SHARED HELPERS  (imported by TenantContract and this module)
# ─────────────────────────────────────────────────────────────────────────────

def get_pms_settings():
	"""Safely fetch PMS Settings single doc. Returns None on any error."""
	try:
		return frappe.get_single("PMS Settings")
	except Exception:
		return None


def get_due_date(settings=None, contract=None):
	"""
	Calculate due date.

	Priority: contract.rent_due_day → settings.rent_due_day → 15 days from today.
	"""
	due_day = None

	if contract and getattr(contract, "rent_due_day", None):
		due_day = int(contract.rent_due_day)

	if not due_day and settings and getattr(settings, "rent_due_day", None):
		due_day = int(settings.rent_due_day)

	if not due_day:
		return add_days(nowdate(), 15)

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


def get_utility_item_code(meter_type):
	"""
	Resolve the ERPNext Item code for a given Meter Type.
	Returns None (soft) so callers can log and skip gracefully.
	"""
	return frappe.db.get_value("Meter Type", meter_type, "item")


def generate_invoice_number_for_company(company):
	"""
	Generate the next sequential custom_invoice_no for the given company.
	Format: ABBR-YYYY-00001
	"""
	abbr = (frappe.db.get_value("Company", company, "abbr") or company[:3]).upper()
	year = nowdate()[:4]
	pattern = f"{abbr}-{year}-%"
	count = frappe.db.count(
		"Sales Invoice", filters={"custom_invoice_no": ["like", pattern]}
	)
	return f"{abbr}-{year}-{(count or 0) + 1:05d}"


def create_reading_log(meter, consumption, amount, invoice_name=None):
	"""
	Create a Meter Reading Log audit record.
	Non-fatal — logs errors rather than raising.
	"""
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


def get_deposit_settings_for_company(company):
	"""
	Return per-company deposit settings from PMS Settings,
	falling back to global defaults.

	Returns a dict with keys:
	  deposit_liability_account, security_deposit_months,
	  deposit_interest_rate, require_move_inspection
	"""
	settings = get_pms_settings()
	if not settings:
		return {}

	for row in (settings.company_deposit_settings or []):
		if row.company == company:
			return {
				"deposit_liability_account": row.deposit_liability_account,
				"security_deposit_months": row.security_deposit_months or 1,
				"deposit_interest_rate": flt(row.deposit_interest_rate),
				"require_move_inspection": row.require_move_inspection,
			}

	return {
		"deposit_liability_account": settings.default_deposit_liability_account,
		"security_deposit_months": settings.default_security_deposit_months or 1,
		"deposit_interest_rate": flt(settings.deposit_interest_rate),
		"require_move_inspection": settings.require_move_inspection_for_deposit,
	}


# ─────────────────────────────────────────────────────────────────────────────
#  PRIVATE HELPERS
# ─────────────────────────────────────────────────────────────────────────────

def _already_invoiced_this_month(contract_name, party_name=None):
	"""
	Return True if a non-cancelled rent invoice already exists this calendar month
	for this contract.

	Checks by custom_tenant_contract first (fast), falls back to
	customer + RENT_ITEM_CODE scan if the custom field is not present.
	"""
	today = getdate(nowdate())
	month_start = f"{today.year}-{today.month:02d}-01"
	month_end = (
		f"{today.year}-{today.month:02d}-"
		f"{calendar.monthrange(today.year, today.month)[1]}"
	)

	# Primary check – custom_tenant_contract field (set by _make_invoice)
	try:
		invoices = frappe.get_all(
			"Sales Invoice",
			filters={
				"custom_tenant_contract": contract_name,
				"docstatus": ["!=", 2],
				"posting_date": ["between", [month_start, month_end]],
			},
			fields=["name"],
			limit=1,
		)
		if invoices:
			# confirm it has a rent line (not just a utility invoice)
			for inv in invoices:
				if frappe.db.exists(
					"Sales Invoice Item",
					{"parent": inv.name, "item_code": RENT_ITEM_CODE},
				):
					return True
	except Exception:
		pass  # field may not exist on some sites; fall through to secondary check

	# Fallback check – customer + month + rent item
	if not party_name:
		return False

	customer = frappe.db.get_value("Tenant", party_name, "customer")
	if not customer:
		return False

	inv_names = frappe.get_all(
		"Sales Invoice",
		filters={
			"customer": customer,
			"docstatus": ["!=", 2],
			"posting_date": ["between", [month_start, month_end]],
		},
		pluck="name",
	)
	for inv_name in inv_names:
		if frappe.db.exists(
			"Sales Invoice Item",
			{"parent": inv_name, "item_code": RENT_ITEM_CODE},
		):
			return True

	return False


def _unit_already_billed_this_month(unit_name):
	"""
	Return True if a non-cancelled invoice was posted this month for the
	unit's active contract (prevents double-billing utility meters).
	"""
	today = getdate(nowdate())
	month_start = f"{today.year}-{today.month:02d}-01"
	month_end = (
		f"{today.year}-{today.month:02d}-"
		f"{calendar.monthrange(today.year, today.month)[1]}"
	)

	contract_name = frappe.db.get_value(
		"Tenant Contract",
		{"unit": unit_name, "status": "Active"},
		"name",
	)
	if not contract_name:
		return False

	try:
		return bool(frappe.get_all(
			"Sales Invoice",
			filters={
				"custom_tenant_contract": contract_name,
				"docstatus": ["!=", 2],
				"posting_date": ["between", [month_start, month_end]],
			},
			limit=1,
		))
	except Exception:
		return False


def _create_standalone_utility_invoice(meter, consumption, settings=None):
	"""
	Build and submit a Sales Invoice for a standalone Utility Meter.
	This path is only used by process_meter_billing() for meters that are NOT
	being billed through a contract's generate_sales_invoice().
	"""
	if not meter.unit:
		frappe.log_error(f"Meter {meter.meter_id} has no unit.", "Utility Billing")
		return None

	current_tenant = frappe.db.get_value("Unit", meter.unit, "current_tenant")
	if not current_tenant:
		frappe.log_error(f"Unit {meter.unit} has no current tenant.", "Utility Billing")
		return None

	customer = frappe.db.get_value("Tenant", current_tenant, "customer")
	if not customer:
		frappe.log_error(f"Tenant {current_tenant} has no linked Customer.", "Utility Billing")
		return None

	item_code = get_utility_item_code(meter.meter_type)
	if not item_code:
		frappe.log_error(
			f"Meter Type '{meter.meter_type}' has no linked ERPNext Item.", "Utility Billing"
		)
		return None

	company = frappe.db.get_value(
		"Tenant Contract",
		{"unit": meter.unit, "status": "Active"},
		"company",
	)
	income_account = settings.default_utility_income_account if settings else None
	cost_center = settings.cost_center if settings else None

	item = {
		"item_code": item_code,
		"qty": consumption,
		"rate": flt(meter.tariff_rate),
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
		"set_posting_time": 1,
	}
	if company:
		invoice_data["company"] = company
		invoice_data["custom_invoice_no"] = generate_invoice_number_for_company(company)

	try:
		invoice = frappe.get_doc(invoice_data)
		invoice.insert(ignore_permissions=True)
		invoice.submit()
	except Exception:
		frappe.log_error(
			frappe.get_traceback(),
			f"Standalone utility invoice failed – meter {meter.meter_id}",
		)
		return None

	if settings and settings.send_invoice_automatically:
		try:
			invoice.send_emails()
		except Exception:
			pass

	return invoice.name
