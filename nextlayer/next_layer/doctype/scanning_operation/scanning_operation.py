# Copyright (c) 2025, jr@gmail.com and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document
from erpnext.stock.utils import get_stock_balance


class ScanningOperation(Document):
	def validate(self):
		self.validate_verification_user()
		self.validate_items()
		self.auto_fill_missing_warehouses()
		self.compute_uom_conversions_and_totals()
		self.compute_verification_status()

	def on_submit(self):
		"""Validate before submission"""
		self.validate_items_exist()
		self.validate_verification_complete()
		self.validate_stock_availability()
		# Update verification status to "Skipped Verification" if no verifier is assigned
		if not self.verified_by:
			self.verification_status = "Skipped Verification"

	def validate_items_exist(self):
		"""Validate that items table is not empty before submission"""
		if not self.items or len(self.items) == 0:
			frappe.throw(
				"Cannot submit document with empty items table. Please add at least one item before submitting.",
				title="Items Required"
			)

		# Check if there are any valid items (with item_code)
		valid_items = [item for item in self.items if item.item_code]
		if not valid_items:
			frappe.throw(
				"Cannot submit document. No valid items found in the items table. Please add at least one item before submitting.",
				title="Items Required"
			)

	def validate_verification_complete(self):
		"""Validate that verification is complete before allowing submission"""
		# If both scanned_by and verified_by are set, verification must be complete
		if self.scanned_by and self.verified_by:
			if self.verification_status != "Verified":
				frappe.throw(
					"Only submit if fully verified. Current verification status: {0}".format(self.verification_status),
					title="Verification Required"
				)
			# Check if current user is the verifier (only verifier can submit when both users exist)
			current_user = frappe.session.user
			if current_user != self.verified_by:
				frappe.throw(
					"Only the verifier can submit this document when both scanner and verifier are assigned.",
					title="Submission Restricted"
				)
		# If only scanned_by is set, scanner can submit regardless of verification status

	def validate_verification_user(self):
		"""Validate verification user (no restrictions - same user can scan and verify if needed)"""
		pass

	def validate_items(self):
		"""Validate that all items have required fields"""
		for item in self.items:
			if not item.item_code:
				frappe.throw(f"Item Code is required for row {item.idx}")
			if not item.quantity or item.quantity <= 0:
				frappe.throw(f"Quantity must be greater than 0 for row {item.idx}")
			# Warehouse validation moved to auto_fill_missing_warehouses

	def auto_fill_missing_warehouses(self):
		"""Auto-fill missing warehouses and update warehouses when default warehouse changes"""
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

		# If default warehouse is set, update all items to use it
		if default_warehouse:
			for item in self.items:
				if item.item_code:  # Only update items that have item_code
					item.warehouse = default_warehouse
			return

		# If no default warehouse, use existing logic for auto-fill
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
			if item.item_code and not item.warehouse:
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

	def compute_uom_conversions_and_totals(self):
		"""Compute per-row UOM conversions and aggregate totals on the document."""
		if not getattr(self, "items", None):
			self.total_pairs = 0
			self.total_cartons = 0
			self.total_containers = 0
			return

		def get_item_field(item_code: str, fieldname: str):
			return frappe.db.get_value("Item", item_code, fieldname)

		def get_conversion_factor(item_code: str, uom_name: str) -> float:
			if not item_code or not uom_name:
				return 0.0
			try:
				row = frappe.db.get_value(
					"UOM Conversion Detail",
					{"parent": item_code, "uom": uom_name},
					["conversion_factor"],
					as_dict=True,
				)
				return float(row.conversion_factor) if row and row.conversion_factor else 0.0
			except Exception:
				return 0.0

		total_pairs = 0.0
		total_cartons = 0.0
		total_containers = 0.0

		for d in self.items:
			if not d.item_code:
				continue

			# Ensure stock_uom present
			if not d.stock_uom:
				stock_uom = get_item_field(d.item_code, "stock_uom")
				d.stock_uom = stock_uom

			# Selected UOM: default to sales_uom if missing; if still missing, fallback to parent doc.uom (do NOT fallback to stock_uom)
			selected_uom = d.uom
			if not selected_uom:
				selected_uom = get_item_field(d.item_code, "sales_uom") or getattr(self, "uom", None)
				d.uom = selected_uom

			# Conversion factor for selected UOM to stock UOM
			uom_cf = 1.0 if (selected_uom and d.stock_uom and selected_uom == d.stock_uom) else get_conversion_factor(d.item_code, selected_uom)
			if not uom_cf:
				uom_cf = 1.0
			d.uom_conversion_factor = uom_cf

			qty = float(d.quantity or 0)
			qty_stock = qty * uom_cf
			d.qty_as_per_stock_uom = qty_stock

			# Carton and Container conversion factors
			carton_cf = get_conversion_factor(d.item_code, "Carton")
			container_cf = get_conversion_factor(d.item_code, "Container")
			d.carton_conversion_factor = carton_cf or 0.0
			d.container_conversion_factor = container_cf or 0.0

			# Derive carton/container quantities
			if selected_uom == "Carton":
				d.uomcartons = qty
			elif carton_cf:
				d.uomcartons = qty_stock / carton_cf
			else:
				d.uomcartons = 0.0

			if selected_uom == "Container":
				d.uomcontainers = qty
			elif container_cf:
				d.uomcontainers = qty_stock / container_cf
			else:
				d.uomcontainers = 0.0

			# Accumulate totals
			total_pairs += qty_stock
			total_cartons += float(d.uomcartons or 0)
			total_containers += float(d.uomcontainers or 0)

		# Set document totals
		self.total_pairs = total_pairs
		self.total_cartons = total_cartons
		self.total_containers = total_containers

	def compute_verification_status(self):
		"""Compute verification status based on quantity vs verified_qty comparison"""
		if not getattr(self, "items", None) or not self.items:
			# No items - set to Pending
			self.verification_status = "Pending"
			return

		# If verified_by is not set, status should be Pending
		if not self.verified_by:
			self.verification_status = "Pending"
			return

		# Filter valid items (with item_code)
		valid_items = [item for item in self.items if item.item_code]

		if not valid_items:
			self.verification_status = "Pending"
			return

		# Check if all items have matching quantities
		has_discrepancy = False
		all_verified = True

		for item in valid_items:
			quantity = float(item.quantity or 0)
			verified_qty = float(item.verified_qty or 0)

			# If verified_qty doesn't match quantity, we have a discrepancy
			if quantity != verified_qty:
				has_discrepancy = True
				all_verified = False
				break

			# If verified_qty is 0 for an item with quantity > 0, not fully verified yet
			if verified_qty == 0 and quantity > 0:
				all_verified = False

		# Set verification status
		if has_discrepancy:
			self.verification_status = "Discrepancy"
		elif all_verified:
			# All items have matching verified_qty
			self.verification_status = "Verified"
		else:
			# Still pending verification (some items not verified yet)
			self.verification_status = "Pending"


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
				"sales_uom": getattr(item_doc, "sales_uom", None),
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


