# Copyright (c) 2026, jr@gmail.com and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document


class UtilityMeter(Document):
	def validate(self):
		if self.current_reading and self.last_reading:
			# Validate no negative consumption
			if self.current_reading < self.last_reading:
				frappe.throw(f"Current reading ({self.current_reading}) cannot be less than last reading ({self.last_reading})")
			
			# Auto-calculate consumption
			self.consumption = self.current_reading - self.last_reading
	
