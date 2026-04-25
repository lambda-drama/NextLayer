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