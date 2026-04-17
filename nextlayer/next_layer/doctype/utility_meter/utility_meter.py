# Copyright (c) 2026, jr@gmail.com and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document


class UtilityMeter(Document):
	def validate(doc, method):
		if doc.current_reading and doc.last_reading:
			# Validate no negative consumption
			if doc.current_reading < doc.last_reading:
				frappe.throw(f"Current reading ({doc.current_reading}) cannot be less than last reading ({doc.last_reading})")
			
			# Auto-calculate consumption
			doc.consumption = doc.current_reading - doc.last_reading
	
