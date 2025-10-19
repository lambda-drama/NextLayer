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
		"""Auto-fill UOM from item's default UOM if not set"""
		if self.item_code and not self.uom:
			stock_uom = frappe.get_value("Item", self.item_code, "stock_uom")
			if stock_uom:
				self.uom = stock_uom
