# Copyright (c) 2025, jr@gmail.com and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document
from erpnext.stock.utils import get_stock_balance


class ScanningOperation(Document):
	def validate(self):
		self.validate_items()
		self.auto_fill_missing_warehouses()

	def on_submit(self):
		"""Validate stock availability only on submit"""
		self.validate_stock_availability()

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

	def validate_stock_availability(self):
		"""Validate that sufficient stock is available for each item in the warehouse
		Only validate for Loading operations (items being taken out of warehouse)"""
		if not self.items or self.operation != "Loading":
			return

		for item in self.items:
			if not item.item_code or not item.warehouse:
				continue

			# Get current stock balance for the item in the warehouse
			stock_balance = get_stock_balance(
				item_code=item.item_code,
				warehouse=item.warehouse,
				posting_date=self.date or frappe.utils.today(),
				posting_time=self.posting_time or frappe.utils.nowtime()
			)

			# Check if sufficient stock is available
			if stock_balance < item.quantity:
				frappe.throw(
					f"Insufficient stock for {item.item_name} ({item.item_code}) in warehouse {item.warehouse}. "
					f"Available: {stock_balance}, Required: {item.quantity}",
					title="Stock Validation Error"
				)


@frappe.whitelist()
def get_customers_or_suppliers_by_company(company, parenttype):
	"""Get allowed customers or suppliers for a company based on Party Account settings"""

	restrict_selling_settings = frappe.db.get_single_value("Selling Settings", "custom_restrict_allowed_customers_by_companies")
	restrict_buying_settings = frappe.db.get_single_value("Buying Settings", "custom_restrict_allowed_suppliers_by_companies")

	if not company:
		frappe.throw("Company is required")

	def get_allowed_parties_by_company(company: str, direct_type: str, group_type: str, group_link_field: str) -> list:
		"""
		Fetches allowed parties (customers or suppliers) for a company based on:
		- Direct Party Accounts (e.g., Customer or Supplier)
		- Group Party Accounts (e.g., Customer Group or Supplier Group)

		:param company: Selected Company
		:param direct_type: "Customer" or "Supplier"
		:param group_type: "Customer Group" or "Supplier Group"
		:param group_link_field: Field in direct doctype pointing to group (e.g., "customer_group")
		:return: List of party names
		"""

		# Direct parties with a Party Account for the company
		direct_parties = frappe.db.get_all(
			"Party Account",
			filters={"company": company, "parenttype": direct_type},
			pluck="parent"
		)

		# Groups that have Party Account for the company
		allowed_groups = frappe.db.get_all(
			"Party Account",
			filters={"company": company, "parenttype": group_type},
			pluck="parent"
		)

		group_parties = []
		if allowed_groups:
			group_parties = frappe.db.get_all(
				direct_type,
				filters={group_link_field: ["in", allowed_groups]},
				pluck="name"
			)

		return list(set(direct_parties + group_parties))

	allowed_parties = []
	if parenttype == "Customer":
		allowed_parties = get_allowed_parties_by_company(
			company, direct_type="Customer", group_type="Customer Group", group_link_field="customer_group"
		)
	elif parenttype == "Supplier":
		allowed_parties = get_allowed_parties_by_company(
			company, direct_type="Supplier", group_type="Supplier Group", group_link_field="supplier_group"
		)

	return {
		"allowed_parties": allowed_parties,
		"restrict_selling_settings": restrict_selling_settings,
		"restrict_buying_settings": restrict_buying_settings
	}


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
				"stock_uom": item_doc.stock_uom,
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
def check_stock_availability(item_code, warehouse, quantity, posting_date=None, posting_time=None):
	"""Check if sufficient stock is available for an item in a warehouse"""
	try:
		if not item_code or not warehouse or not quantity:
			return {"available": False, "message": "Item code, warehouse, and quantity are required"}

		# Get current stock balance
		stock_balance = get_stock_balance(
			item_code=item_code,
			warehouse=warehouse,
			posting_date=posting_date or frappe.utils.today(),
			posting_time=posting_time or frappe.utils.nowtime()
		)

		if stock_balance >= quantity:
			return {
				"available": True,
				"stock_balance": stock_balance,
				"required": quantity,
				"message": f"Stock available: {stock_balance}"
			}
		else:
			return {
				"available": False,
				"stock_balance": stock_balance,
				"required": quantity,
				"message": f"Insufficient stock. Available: {stock_balance}, Required: {quantity}"
			}

	except Exception as e:
		frappe.log_error(f"Error checking stock availability for {item_code}: {str(e)}")
		return {"available": False, "message": f"Error checking stock: {str(e)}"}


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


