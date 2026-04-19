# Copyright (c) 2026, jr@gmail.com and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document

class Unit(Document):
    def validate(self):
        # Validate ownership percentage totals 100%
        if self.owners:
            total_percentage = sum([owner.ownership_percentage for owner in self.owners])
            if total_percentage != 100:
                frappe.throw(f"Total ownership percentage must equal 100%. Current total: {total_percentage}%")
            
            owners_list = [owner.owner for owner in self.owners]
            if len(owners_list) != len(set(owners_list)):
                frappe.throw("Duplicate owner found. Each owner can only appear once.")

    def before_save(self):
        ensure_rent_item(self)


def ensure_rent_item(doc):
    # 1. Ensure Item Group exists
    if not frappe.db.exists("Item Group", "Rent"):
        item_group = frappe.get_doc({
            "doctype": "Item Group",
            "item_group_name": "Rent",
            "is_group": 0,
            "parent_item_group": "All Item Groups",
        })
        item_group.insert(ignore_permissions=True)

    item_code = "RENT"

    if frappe.db.exists("Item", item_code):
        doc.rent_item = item_code
    else:
        item = frappe.get_doc({
            "doctype": "Item",
            "item_code": item_code,
            "item_name": "Rent",
            "item_group": "Rent",
            "is_stock_item": 0,
            "is_sales_item": 1,
            "description": "Monthly Rent",
            "stock_uom": "Nos"
        })
        item.insert(ignore_permissions=True)

        doc.rent_item = item.name