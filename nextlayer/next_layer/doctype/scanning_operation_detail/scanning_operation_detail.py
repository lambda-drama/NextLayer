# Copyright (c) 2025, jr@gmail.com and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document


class ScanningOperationDetail(Document):
	def validate(self):
		self.validate_required_fields()
		self.auto_fill_uom()

	def validate_required_fields(self):
		"""Validate required fields"""
		if not self.item_code:
			frappe.throw("Item Code is required")
		if not self.quantity or self.quantity <= 0:
			frappe.throw("Quantity must be greater than 0")
		if not self.warehouse:
			frappe.throw("Warehouse is required")

	def auto_fill_uom(self):
		"""Auto-fill UOM: prefer item's sales_uom; if empty, fallback to parent Scanning Operation.uom"""
		if self.item_code and not self.uom:
			sales_uom = frappe.get_value("Item", self.item_code, "sales_uom")
			if sales_uom:
				self.uom = sales_uom
				return
			# fallback to parent doc.uom
			if self.parenttype and self.parent:
				parent_uom = frappe.db.get_value(self.parenttype, self.parent, "uom")
				if parent_uom:
					self.uom = parent_uom
