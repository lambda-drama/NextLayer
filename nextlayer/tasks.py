"""
tasks.py – Scheduled jobs for the Next Layer / PMS module.
"""

import frappe


def monthly():
	"""Run all monthly scheduled jobs."""
	_run_pms_monthly_billing()


def daily():
	"""Run all daily scheduled jobs."""
	pass  # placeholder for future daily tasks


# ──────────────────────────────────────────
#  PMS – Monthly Billing
# ──────────────────────────────────────────

def _run_pms_monthly_billing():
	"""
	Generate utility invoices for all active meters.
	Skips gracefully if PMS module is not configured.
	"""
	try:
		from nextlayer.next_layer.utils.utility_billing import process_monthly_utility_billing
		process_monthly_utility_billing()
		frappe.logger().info("PMS: Monthly utility billing completed.")
	except Exception:
		frappe.log_error(frappe.get_traceback(), "PMS Monthly Billing – Scheduler Error")
