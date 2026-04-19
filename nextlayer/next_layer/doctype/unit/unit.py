# Copyright (c) 2026, jr@gmail.com and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document


class Unit(Document):
	def validate(doc, method):
		# Validate ownership percentage totals 100%
		if doc.owners:
			total_percentage = sum([owner.ownership_percentage for owner in doc.owners])
			if total_percentage != 100:
				frappe.throw(f"Total ownership percentage must equal 100%. Current total: {total_percentage}%")
			
			# Check for duplicate owners
			owners_list = [owner.owner for owner in doc.owners]
			if len(owners_list) != len(set(owners_list)):
				frappe.throw("Duplicate owner found. Each owner can only appear once.")
    
	def before_save(self):
		create_rent_item(self)



def create_rent_item(doc):
	if not doc.rent_item:
		# Create Item for rent
		item = frappe.get_doc({
			"doctype": "Item",
			"item_code": f"RENT-{doc.unit_number}",
			"item_name": f"Monthly Rent - {doc.unit_number}",
			"item_group": "Rent",
			"is_stock_item": 0,
			"standard_rate": doc.standard_rent,
			"description": f"Monthly rent for unit {doc.unit_number} at {doc.property}"
		})
		item.insert(ignore_permissions=True)
		doc.rent_item = item.name
		frappe.db.set_value("Unit", doc.name, "rent_item", item.name)