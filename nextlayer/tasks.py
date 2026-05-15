"""
tasks.py – Scheduled jobs for the Next Layer / PMS module.

Monthly run order
-----------------
1. process_monthly_invoices()
   Iterates every active Tenant Contract and calls generate_sales_invoice()
   on each – identical to pressing the button on the form.  Controlled by
   PMS Settings.invoice_generation_day.

2. process_monthly_utility_billing()
   Iterates standalone active Utility Meters that were NOT already billed
   through a contract invoice this month and creates individual utility
   invoices.
"""

import frappe


def monthly():
	"""Entry-point for Frappe's monthly scheduler."""
	_run_pms_monthly_invoices()
	_run_pms_utility_billing()


def daily():
	"""Entry-point for Frappe's daily scheduler."""
	_run_expire_tenant_contracts()


# ─────────────────────────────────────────────────────────────────────────────
#  Private runners
# ─────────────────────────────────────────────────────────────────────────────

def _run_expire_tenant_contracts():
	"""Mark Active tenant contracts as Expired when end_date has passed."""
	try:
		from nextlayer.next_layer.doctype.tenant_contract.tenant_contract import (
			expire_tenant_contracts_by_end_date,
		)
		expire_tenant_contracts_by_end_date()
		frappe.logger().info("PMS: Tenant contract expiry check complete.")
	except Exception:
		frappe.log_error(
			frappe.get_traceback(),
			"PMS Tenant Contract Expiry – Scheduler Error",
		)


def _run_pms_monthly_invoices():
	"""
	Generate rent + service + utility invoices for all active Tenant Contracts.
	Uses the same code path as the manual 'Generate Sales Invoice' button.
	"""
	try:
		from nextlayer.next_layer.utils.utility_billing import process_monthly_invoices
		result = process_monthly_invoices()
		frappe.logger().info(f"PMS: Monthly contract invoicing complete – {result}")
	except Exception:
		frappe.log_error(
			frappe.get_traceback(),
			"PMS Monthly Invoicing – Scheduler Error",
		)


def _run_pms_utility_billing():
	"""
	Generate standalone utility invoices for active meters not already billed
	through a contract run this month.
	"""
	try:
		from nextlayer.next_layer.utils.utility_billing import process_monthly_utility_billing
		process_monthly_utility_billing()
		frappe.logger().info("PMS: Standalone utility billing complete.")
	except Exception:
		frappe.log_error(
			frappe.get_traceback(),
			"PMS Utility Billing – Scheduler Error",
		)
