# Copyright (c) 2026, jr@gmail.com and contributors
# For license information, please see license.txt

# import frappe
from frappe.model.document import Document


# Copyright (c) 2026, jr@gmail.com and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document

class MeterType(Document):
    
    def before_save(self):
        """Before saving, ensure Item Group 'Service' exists and create Item if needed"""
        
        # 1. Ensure Service Item Group exists
        self.create_service_item_group()
        
        # 2. Create Item if it doesn't exist or match the meter type
        if not self.item:
            self.create_item_from_meter_type()
        else:
            # Check if existing item matches meter type name
            item_name = frappe.db.get_value("Item", self.item, "item_name")
            if item_name != self.meter_type:
                self.create_item_from_meter_type()
    
    def create_service_item_group(self):
        """Create 'Service' item group if it doesn't exist"""
        if not frappe.db.exists("Item Group", "Service"):
            item_group = frappe.get_doc({
                "doctype": "Item Group",
                "item_group_name": "Service",
                "parent_item_group": "All Item Groups"
            })
            item_group.insert()
            frappe.db.commit()
    
    def create_item_from_meter_type(self):
        """Create an Item based on Meter Type"""
        
        # Check if item already exists with this name
        existing_item = frappe.db.exists("Item", {"item_name": self.meter_type})
        
        if existing_item:
            # Item exists, just link it
            self.item = existing_item
        else:
            # Create new item
            new_item = frappe.get_doc({
                "doctype": "Item",
                "item_code": self.meter_type.upper().replace(" ", "-"),
                "item_name": self.meter_type,
                "item_group": "Service",
                "is_stock_item": 0,
                "description": f"Meter Type: {self.meter_type}",
                "standard_rate": 0
            })
            new_item.insert()
            self.item = new_item.name
            frappe.db.commit()
    
    def validate(self):
        """Validate meter type fields"""
        if not self.meter_type:
            frappe.throw("Meter Type is required")
        
        if not self.unit_of_measure:
            frappe.throw("Unit of Measure is required")
