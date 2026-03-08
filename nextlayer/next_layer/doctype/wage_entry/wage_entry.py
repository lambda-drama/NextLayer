# Copyright (c) 2026, jr@gmail.com and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document
from frappe.utils import flt


class WageEntry(Document):
	def validate(self):
		self.calculate_totals()

	def calculate_totals(self):
		"""Set amount per row (qty * rate) and total_qty, total_amount on main doc."""
		total_qty = 0
		total_amount = 0
		for row in self.wages or []:
			qty = flt(row.get("qty"), 0)
			rate = flt(row.get("rate"), 0)
			row.amount = qty * rate
			total_qty += qty
			total_amount += row.amount
		self.total_qty = total_qty
		self.total_amount = total_amount
