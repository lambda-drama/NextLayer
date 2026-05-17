# Copyright (c) 2026, jr@gmail.com and contributors
# For license information, please see license.txt

# import frappe
import frappe
from frappe.model.document import Document

class PMSSettings(Document):
	
	def on_update(self):
		"""When PMS Settings is saved, update the monthly billing scheduler"""
		if self.active:
			self._manage_monthly_invoice_scheduler()
	
	def _manage_monthly_invoice_scheduler(self):
		"""Create, update, or delete the scheduled job based on settings"""
		
		method_name = "nextlayer.next_layer.utils.utility_billing.trigger_monthly_invoices"
		current_day = self.get("invoice_generation_day")
		# If no day selected or day is 0, delete scheduler
		if not current_day or current_day == 0:
			delete_scheduled_job(method_name)
			return
		# Validate day is between 1 and 28
		if current_day < 1 or current_day > 28:
			frappe.throw("Monthly Invoice Generation Day must be between 1 and 28")
		
		# Create or update the scheduled job
		# Run at 2 AM on the selected day of each month
		cron_format = f"0 2 {current_day} * *"
		get_or_create_scheduled_job(method_name, "Cron", cron_format)
	
	def validate(self):
		"""Validate the monthly invoice generation day"""
		day = self.get("invoice_generation_day")
		if day and (day < 1 or day > 28):
			frappe.throw("Monthly Invoice Generation Day must be between 1 and 28")

	@frappe.whitelist()
	def reset_units_without_active_contract(self):
		"""
		Set units to Available when they have no submitted Active Tenant Contract.
		Clears current_tenant and current_contract on affected units.
		"""
		return reset_units_without_active_contract()


# ──────────────────────────────────────────
#  SCHEDULED JOB HELPERS
# ──────────────────────────────────────────

def get_or_create_scheduled_job(
	method_name: str, frequency: str, cron_format: str | None = None
) -> None:
	"""Get existing scheduled job or create new one, then update it."""
	
	task: str | None = frappe.db.exists(
		"Scheduled Job Type", {"method": ["like", f"%{method_name}%"]}
	)

	if task:
		task = frappe.get_doc("Scheduled Job Type", task)
	else:
		task = frappe.new_doc("Scheduled Job Type")
		task.method = method_name

	task.frequency = frequency

	if frequency == "Cron" and cron_format:
		task.cron_format = cron_format

	task.save(ignore_permissions=True)


def delete_scheduled_job(method_name: str) -> None:
	"""Delete the Scheduled Job Type for the given method if it exists."""
	job_name = frappe.db.exists("Scheduled Job Type", {"method": ["like", f"%{method_name}%"]})
	if job_name:
		frappe.delete_doc("Scheduled Job Type", job_name, ignore_permissions=True)


@frappe.whitelist()
def reset_units_without_active_contract():
	"""
	For every unit with no submitted Active Tenant Contract, set status to Available
	and clear occupancy fields. Fixes units left Occupied after expired/ended leases.
	"""
	active_rows = frappe.get_all(
		"Tenant Contract",
		filters={"docstatus": 1, "status": "Active"},
		fields=["unit"],
	)
	units_with_active = {r.unit for r in active_rows if r.get("unit")}

	all_units = frappe.get_all("Unit", pluck="name")
	updated = []

	for unit_name in all_units:
		if unit_name in units_with_active:
			continue
		frappe.db.set_value(
			"Unit",
			unit_name,
			{
				"status": "Available",
				"is_occupied": 0,
				"current_tenant": None,
				"current_contract": None,
			},
			update_modified=True,
		)
		updated.append(unit_name)

	frappe.db.commit()

	return {
		"updated_count": len(updated),
		"updated_units": updated,
	}