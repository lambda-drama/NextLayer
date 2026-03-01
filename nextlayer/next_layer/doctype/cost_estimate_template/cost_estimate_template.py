# Copyright (c) 2026, Next Layer and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document
from frappe.utils import flt


class CostEstimateTemplate(Document):
	def validate(self):
		self.calculate_totals()

	def calculate_totals(self):
		"""Calculate total material, labor, overhead and grand total."""
		total_material = sum(flt(row.get("amount")) for row in (self.items or []))
		self.total_material_cost = total_material

		total_labor = 0
		for row in (self.labor or []):
			if row.get("calculation_type") == "Per Day":
				total_labor += flt(row.get("days"), 0) * flt(row.get("daily_rate"), 0)
			else:
				total_labor += flt(row.get("amount"), 0)
		self.total_labor_cost = total_labor

		total_overhead = sum(flt(row.get("amount")) for row in (self.overheads or []))
		self.total_overhead_cost = total_overhead

		self.grand_total = total_material + total_labor + total_overhead
