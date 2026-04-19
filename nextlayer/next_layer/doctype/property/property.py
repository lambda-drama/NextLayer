# Copyright (c) 2026, jr@gmail.com and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document


class Property(Document):
	def validate(self):
		total = sum([row.percentage_ownership or 0 for row in self.property_owners])

		total = round(total, 2)

		if self.property_owners and total != 100:
			frappe.throw(f"Total ownership percentage must be 100%. Current total is {total}%")
		
