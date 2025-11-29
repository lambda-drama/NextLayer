# Copyright (c) 2025, jr@gmail.com and contributors
# For license information, please see license.txt

import frappe
from collections import defaultdict


@frappe.whitelist()
def get_referenced_loading_operations():
	"""Get list of Loading Scanning Operations that have already been referenced by SUBMITTED Offloading operations
	Only Loading operations referenced by submitted (docstatus=1) Offloading operations are considered as referenced"""
	try:
		# Query all SUBMITTED Offloading Scanning Operations that have a scanning_operation field set
		# Only submitted documents (docstatus=1) count as "referenced"
		offloading_docs = frappe.get_all(
			"Scanning Operation",
			filters={
				"operation": "Offloading",
				"scanning_operation": ["is", "set"],
				"docstatus": 1  # Only submitted documents
			},
			fields=["scanning_operation"],
			pluck="scanning_operation"
		)
		
		# Remove duplicates and None values
		referenced_operations = list(set([op for op in offloading_docs if op]))
		
		return referenced_operations
	except Exception as e:
		frappe.log_error(f"Error getting referenced loading operations: {str(e)}")
		return []


@frappe.whitelist()
def get_items_from_scanning_operation(scanning_operation, parent_only=False):
	"""Get items from Scanning Operation for creating other documents or copying to another Scanning Operation
	Supports parent/child item grouping"""
	try:
		so_doc = frappe.get_doc("Scanning Operation", scanning_operation)
		# Properly convert checkbox value to boolean
		parent_only = parent_only in (True, 1, "1", "true", "True")

		items = []
		for item in so_doc.items:
			items.append({
				"item_code": item.item_code,
				"item_name": item.item_name,
				"quantity": item.quantity,
				"warehouse": item.warehouse,
				"description": item.description,
				"barcode": item.barcode,
				"uom": item.uom,
				"stock_uom": item.stock_uom,
				"uom_conversion_factor": item.uom_conversion_factor,
				"qty_as_per_stock_uom": item.qty_as_per_stock_uom,
				"uomcontainers": item.uomcontainers,
				"uomcartons": item.uomcartons,
				"container_conversion_factor": item.container_conversion_factor,
				"carton_conversion_factor": item.carton_conversion_factor
			})
		
		# Apply parent/child grouping if parent_only is True
		if parent_only:
			items = group_scanning_items_by_parent(items)

		# Get shipping details
		shipping_details = {
			"container_no": so_doc.container_no or '',
			"port_of_loading": so_doc.port_of_loading or '',
			"data_ncab": so_doc.data_ncab or '',
			"bil": so_doc.bil or '',
			"bill_of_exit": so_doc.bill_of_exit or '',
			"estimated_date_of_departure": so_doc.estimated_date_of_departure or '',
			"destination": so_doc.destination or '',
			"port_of_discharge": so_doc.port_of_discharge or '',
			"container_quantity": so_doc.container_quantity or 0,
			"shipping_line": so_doc.shipping_line or '',
			"estimated_date_of_arrival": so_doc.estimated_date_of_arrival or '',
			"remaining_days": so_doc.remaining_days or 0,
			"actual_arrival_date": so_doc.actual_arrival_date or '',
			"shipping_status": so_doc.shipping_status or ''
		}

		# Get accounting dimensions
		accounting_details = {
			"marka": so_doc.marka or '',
			"branch": so_doc.branch or '',
			"company_group": so_doc.company_group or '',
			"cost_center": so_doc.cost_center or '',
			"project": so_doc.project or ''
		}

		return {
			"items": items,
			"customer": so_doc.customer,
			"company": so_doc.company,
			"date": so_doc.date,
			"posting_time": so_doc.posting_time,
			"scanning_name": so_doc.scanning_name or '',
			"shipping_details": shipping_details,
			"accounting_details": accounting_details
		}

	except Exception as e:
		frappe.log_error(f"Error getting items from scanning operation {scanning_operation}: {str(e)}")
		return None


def group_scanning_items_by_parent(items):
	"""Group scanning operation items based on parent/child relationships"""
	if not items:
		return items
	
	processed_items = []
	parent_groups = defaultdict(lambda: {
		'item_code': None,
		'item_name': None,
		'quantity': 0,
		'warehouse': None,
		'description': None,
		'barcode': None,
		'uom': None,
		'stock_uom': None,
		'uom_conversion_factor': 1.0,
		'qty_as_per_stock_uom': 0,
		'uomcontainers': 0,
		'uomcartons': 0,
		'container_conversion_factor': 0,
		'carton_conversion_factor': 0
	})
	
	for item in items:
		item_code = item.get('item_code')
		if not item_code:
			continue
		
		# Check if item is a child (has parent)
		try:
			item_doc = frappe.get_cached_doc("Item", item_code)
			parent_item = getattr(item_doc, 'custom_parent_item', None)
		except Exception:
			parent_item = None
		
		if parent_item:
			# This is a child item, group by parent
			parent_group = parent_groups[parent_item]
			if not parent_group['item_code']:
				# First time seeing this parent, initialize with parent item details
				parent_group['item_code'] = parent_item
				try:
					parent_doc = frappe.get_cached_doc("Item", parent_item)
					parent_group['item_name'] = parent_doc.item_name
					parent_group['stock_uom'] = parent_doc.stock_uom
				except Exception:
					# If parent item doesn't exist, use child item details
					parent_group['item_name'] = item.get('item_name', '')
					parent_group['stock_uom'] = item.get('stock_uom')
			
			# Always prefer the transaction's UOM
			transaction_uom = item.get('uom')
			if transaction_uom:
				parent_group['uom'] = transaction_uom
			elif not parent_group['uom']:
				# Fall back to the parent's sales UOM or stock UOM
				try:
					parent_doc = frappe.get_cached_doc("Item", parent_item)
					parent_group['uom'] = getattr(parent_doc, 'sales_uom', None) or parent_doc.stock_uom
				except Exception:
					parent_group['uom'] = item.get('uom') or item.get('stock_uom')
			
			# Accumulate quantities and other values
			parent_group['quantity'] += item.get('quantity', 0) or 0
			parent_group['qty_as_per_stock_uom'] += item.get('qty_as_per_stock_uom', 0) or 0
			parent_group['uomcontainers'] += item.get('uomcontainers', 0) or 0
			parent_group['uomcartons'] += item.get('uomcartons', 0) or 0
			
			# Use first warehouse found (or prefer current document's warehouse)
			if not parent_group['warehouse']:
				parent_group['warehouse'] = item.get('warehouse')
			
			# Use first description found
			if not parent_group['description']:
				parent_group['description'] = item.get('description')
			
			# Use first barcode found
			if not parent_group['barcode']:
				parent_group['barcode'] = item.get('barcode')
			
			# Use conversion factors from first item (they should be the same for same parent)
			if not parent_group['uom_conversion_factor'] or parent_group['uom_conversion_factor'] == 1.0:
				parent_group['uom_conversion_factor'] = item.get('uom_conversion_factor', 1.0)
			if not parent_group['container_conversion_factor']:
				parent_group['container_conversion_factor'] = item.get('container_conversion_factor', 0)
			if not parent_group['carton_conversion_factor']:
				parent_group['carton_conversion_factor'] = item.get('carton_conversion_factor', 0)
		else:
			# This is already a parent item, add as is
			processed_items.append(item)
	
	# Process parent groups and add to processed items
	for parent_item, group_data in parent_groups.items():
		processed_items.append(group_data)
	
	return processed_items



