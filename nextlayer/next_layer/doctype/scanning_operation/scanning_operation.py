# Copyright (c) 2025, jr@gmail.com and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document


class ScanningOperation(Document):
	def validate(self):
		self.validate_items()
		self.auto_fill_missing_warehouses()

	def validate_items(self):
		"""Validate that all items have required fields"""
		for item in self.items:
			if not item.item_code:
				frappe.throw(f"Item Code is required for row {item.idx}")
			if not item.quantity or item.quantity <= 0:
				frappe.throw(f"Quantity must be greater than 0 for row {item.idx}")
			# Warehouse validation moved to auto_fill_missing_warehouses

	def auto_fill_missing_warehouses(self):
		"""Auto-fill missing warehouses before validation"""
		if not self.items:
			return

		default_warehouse = ""
		items_with_warehouse = []
		items_without_warehouse = []

		# Determine default warehouse based on operation
		if self.operation == "Loading" and self.ds_warehouse:
			default_warehouse = self.ds_warehouse
		elif self.operation == "Offloading" and self.dt_warehouse:
			default_warehouse = self.dt_warehouse

		# Categorize items
		for item in self.items:
			if item.warehouse:
				items_with_warehouse.append(item.warehouse)
			else:
				items_without_warehouse.append(item)

		# Auto-fill missing warehouses
		if items_without_warehouse:
			warehouse_to_use = ""

			# Priority 1: Use default warehouse if available
			if default_warehouse:
				warehouse_to_use = default_warehouse
			# Priority 2: Use warehouse from existing items
			elif items_with_warehouse:
				warehouse_to_use = items_with_warehouse[0]

			# Apply warehouse to items without warehouse
			if warehouse_to_use:
				for item in items_without_warehouse:
					item.warehouse = warehouse_to_use

		# Final validation - ensure all items have warehouse
		for item in self.items:
			if not item.warehouse:
				frappe.throw(f"Warehouse is required for row {item.idx}. Please set default warehouse or specify warehouse for this item.")


@frappe.whitelist()
def get_item_by_barcode(barcode):
	"""Get item details by barcode"""
	try:
		# First check Item Barcode doctype
		barcode_doc = frappe.get_value("Item Barcode", {"barcode": barcode}, ["parent"], as_dict=True)

		if barcode_doc:
			item_code = barcode_doc.parent
		else:
			# If not found in Item Barcode, check if barcode itself is item code
			item_code = frappe.get_value("Item", {"name": barcode}, "name")

		if item_code:
			item_doc = frappe.get_doc("Item", item_code)
			return {
				"item_code": item_code,
				"item_name": item_doc.item_name,
				"description": item_doc.description,
				"barcode": barcode
			}
		else:
			return None

	except Exception as e:
		frappe.log_error(f"Error getting item by barcode {barcode}: {str(e)}")
		return None


@frappe.whitelist()
def get_items_by_barcode_list(barcode_list):
	"""Get multiple items by barcode list"""
	items = []
	for barcode in barcode_list:
		item = get_item_by_barcode(barcode)
		if item:
			items.append(item)
	return items


@frappe.whitelist()
def get_items_from_scanning_operation(scanning_operation):
	"""Get items from Scanning Operation for creating other documents"""
	try:
		so_doc = frappe.get_doc("Scanning Operation", scanning_operation)

		items = []
		for item in so_doc.items:
			items.append({
				"item_code": item.item_code,
				"item_name": item.item_name,
				"quantity": item.quantity,
				"warehouse": item.warehouse,
				"description": item.description,
				"barcode": item.barcode
			})

		return {
			"items": items,
			"customer": so_doc.customer,
			"company": so_doc.company,
			"date": so_doc.date,
			"posting_time": so_doc.posting_time
		}

	except Exception as e:
		frappe.log_error(f"Error getting items from scanning operation {scanning_operation}: {str(e)}")
		return None


