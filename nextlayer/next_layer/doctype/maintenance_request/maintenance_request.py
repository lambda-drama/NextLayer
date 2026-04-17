# Copyright (c) 2026, jr@gmail.com and contributors
# For license information, please see license.txt

# import frappe
from frappe.model.document import Document


class MaintenanceRequest(Document):
	def validate(doc, method):
		# Calculate response time
		if doc.assigned_date and doc.request_date:
			response_seconds = (doc.assigned_date - doc.request_date).total_seconds()
			doc.response_time = response_seconds
		
		# Calculate resolution time
		if doc.completed_date and doc.request_date:
			resolution_seconds = (doc.completed_date - doc.request_date).total_seconds()
			doc.resolution_time = resolution_seconds
		
		# Check SLA breach
		sla_hours = {
			"Emergency": 2,
			"High": 24,
			"Medium": 72,
			"Low": 168
		}
		
		if doc.priority in sla_hours and doc.response_time:
			response_hours = doc.response_time / 3600
			if response_hours > sla_hours[doc.priority]:
				doc.sla_breached = 1
				doc.sla_notes = f"SLA breached. Expected {sla_hours[doc.priority]} hours, took {response_hours:.1f} hours"
		pass
