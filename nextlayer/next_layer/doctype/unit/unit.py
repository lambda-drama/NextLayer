# Copyright (c) 2026, jr@gmail.com and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document

RENT_ITEM_CODE = "RENT-CHARGES"
RENT_ITEM_NAME = "Rent Charges"


class Unit(Document):
	def validate(self):
		if self.owners:
			total = sum(o.ownership_percentage for o in self.owners)
			if total != 100:
				frappe.throw(
					f"Total ownership percentage must equal 100%. Current total: {total}%"
				)
			names = [o.owner for o in self.owners]
			if len(names) != len(set(names)):
				frappe.throw("Duplicate owner found. Each owner can only appear once.")

	def before_save(self):
		_ensure_rent_item(self)

	def autoname(self):
		unit = self.unit_number or "UNIT"
		prop = self.property or "GEN"
		self.name = f"{unit}-{prop}"

	@frappe.whitelist()
	def generate_sales_invoice(self):
		"""Delegate to the active Tenant Contract for this unit."""
		contract_name = frappe.db.get_value(
			"Tenant Contract",
			{"unit": self.name, "status": "Active", "docstatus": 1},
			"name",
		)
		if not contract_name:
			frappe.throw(
				f"No active submitted Tenant Contract found for unit '{self.name}'. "
				"Please activate a contract first."
			)

		contract = frappe.get_doc("Tenant Contract", contract_name)
		return contract.generate_sales_invoice()


def _ensure_rent_item(doc):
	"""Create Rent Charges Item and its prerequisites if they don't exist."""
	if not frappe.db.exists("Item Group", "Rent"):
		frappe.get_doc({
			"doctype": "Item Group",
			"item_group_name": "Rent",
			"is_group": 0,
			"parent_item_group": "All Item Groups",
		}).insert(ignore_permissions=True)

	if not frappe.db.exists("UOM", "Month"):
		frappe.get_doc({"doctype": "UOM", "uom_name": "Month"}).insert(
			ignore_permissions=True
		)

	if frappe.db.exists("Item", RENT_ITEM_CODE):
		doc.rent_item = RENT_ITEM_CODE
	else:
		frappe.get_doc({
			"doctype": "Item",
			"item_code": RENT_ITEM_CODE,
			"item_name": RENT_ITEM_NAME,
			"item_group": "Rent",
			"is_stock_item": 0,
			"is_sales_item": 1,
			"description": "Monthly Rent Charge",
			"stock_uom": "Month",
		}).insert(ignore_permissions=True)
		doc.rent_item = RENT_ITEM_CODE
