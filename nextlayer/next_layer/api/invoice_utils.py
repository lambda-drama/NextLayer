# Copyright (c) 2025, jr@gmail.com and contributors
# For license information, please see license.txt

import frappe
from collections import defaultdict


def get_accounts(item_code, company):
	"""Get income account for item from item defaults or company defaults"""
	try:
		item_doc = frappe.get_doc("Item", item_code)
		item_defaults = item_doc.get("item_defaults")

		if item_defaults:
			for default in item_defaults:
				if default.get("company") == company:
					this_company = frappe.get_doc("Company", company)
					income_account = this_company.default_income_account
					return income_account

		return None

	except Exception as e:
		frappe.log_error(f"Error fetching income account for {item_code} and {company}: {str(e)[:140]}", "Income Account Fetch Error")
		return None


def get_expense_accounts(item_code, company):
	"""Get expense account for item from item defaults or company defaults"""
	try:
		item_doc = frappe.get_doc("Item", item_code)
		item_defaults = item_doc.item_defaults

		if item_defaults:
			for default in item_defaults:
				if default.get("company") == company:
					this_company = frappe.get_doc("Company", company)
					expense_account = this_company.default_expense_account
					return expense_account

		return None

	except Exception as e:
		frappe.log_error(f"Error fetching expense account for {item_code}: {str(e)[:140]}", "Expense Account Fetch Error")
		return None


def group_items_by_parent(items, parent_only=False):
	"""
	Group items based on parent/child relationships
	
	Args:
		items: List of item dictionaries
		parent_only: Boolean - if True, group child items by their parent
	
	Returns:
		List of processed items
	"""
	if not parent_only:
		return items
	
	processed_items = []
	
	# Group child items by their parent and accumulate quantities
	parent_groups = defaultdict(lambda: {
			'item_code': None,
			'item_name': None,
			'qty': 0,
			'rate': 0,
			'amount': 0,
			'stock_uom': None,
			'uom': None,
			'custom_containers': 0,
			'custom_cartons': 0,
			'stock_qty': 0,
			'income_account': None,
			'expense_account': None,
			'custom_item_identifier': None
		})
	
	for item in items:
		item_code = item.get('item_code')
		if not item_code:
			continue
		
		# Check if item is a child (has parent)
		item_doc = frappe.get_cached_doc("Item", item_code)
		parent_item = getattr(item_doc, 'custom_parent_item', None)
		
		if parent_item:
			# This is a child item, group by parent
			if not parent_groups[parent_item]['item_code']:
				# First time seeing this parent, initialize with parent item details
				parent_groups[parent_item]['item_code'] = parent_item
				try:
					parent_doc = frappe.get_cached_doc("Item", parent_item)
					parent_groups[parent_item]['item_name'] = parent_doc.item_name
					parent_groups[parent_item]['stock_uom'] = parent_doc.stock_uom
					parent_groups[parent_item]['uom'] = getattr(parent_doc, 'sales_uom', None) or parent_doc.stock_uom
				except Exception:
					# If parent item doesn't exist, use child item details
					parent_groups[parent_item]['item_name'] = item.get('item_name', '')
					parent_groups[parent_item]['stock_uom'] = item.get('stock_uom')
					parent_groups[parent_item]['uom'] = item.get('uom')
			
			# Accumulate quantities and amounts
			parent_groups[parent_item]['qty'] += item.get('qty', 0) or 0
			parent_groups[parent_item]['amount'] += item.get('amount', 0) or 0
			# Use weighted average for rate
			if parent_groups[parent_item]['qty'] > 0:
				parent_groups[parent_item]['rate'] = parent_groups[parent_item]['amount'] / parent_groups[parent_item]['qty']
			parent_groups[parent_item]['custom_containers'] += item.get('custom_containers', 0) or 0
			parent_groups[parent_item]['custom_cartons'] += item.get('custom_cartons', 0) or 0
			parent_groups[parent_item]['stock_qty'] += item.get('stock_qty', 0) or 0
			parent_groups[parent_item]['income_account'] = parent_groups[parent_item]['income_account'] or item.get('income_account')
			parent_groups[parent_item]['expense_account'] = parent_groups[parent_item]['expense_account'] or item.get('expense_account')
		else:
			# This is already a parent item, add as is
			processed_items.append(item)
	
	# Add grouped parent items
	processed_items.extend(list(parent_groups.values()))
	
	return processed_items


@frappe.whitelist()
def get_items_from_selected_sal_invoice(sales_invoice, company, parent_only=False):
	"""
	Get items from Sales Invoice for Purchase Invoice
	Supports parent/child item grouping
	"""
	selected_sales_invoice = sales_invoice
	company = company
	# Properly convert checkbox value to boolean
	parent_only = parent_only in (True, 1, "1", "true", "True")

	# Log the selected sales invoice and company for debugging
	frappe.log_error(f"Selected Sales Invoice: {selected_sales_invoice}", "Debugging")
	frappe.log_error(f"Selected Company: {company}", "Debugging")
	frappe.log_error(f"Parent Only: {parent_only}", "Debugging")

	if not selected_sales_invoice:
		frappe.throw("Sales invoice is not provided or is invalid.")

	if not company:
		frappe.throw("Company is not provided or is invalid.")

	purchase_invoice_items = []
	transit_numbers = []

	try:
		sales_invoice_doc = frappe.get_doc("Sales Invoice", selected_sales_invoice)
		
		# Ensure the sales invoice is submitted before proceeding
		if sales_invoice_doc.docstatus != 1:
			frappe.throw(f"Selected sales invoice must be submitted.")
		
		frappe.log_error(f"Fetched Sales Invoice: {selected_sales_invoice}", "Sales Invoice Document")
		
		for item in sales_invoice_doc.items:
			income_account = get_accounts(item.item_code, company)
			expense_account = get_expense_accounts(item.item_code, company)
			
			item_details = {
				'item_code': item.item_code,
				'item_name': item.item_name,
				'qty': item.qty,
				'rate': item.rate,
				'amount': item.amount,
				'stock_uom': item.stock_uom,
				'stock_qty': item.stock_qty,
				'uom': item.uom,
				'custom_containers': item.custom_containers,
				'custom_cartons': item.custom_cartons,
				'income_account': income_account,
				'expense_account': expense_account
			}
			purchase_invoice_items.append(item_details)
		
		# Apply parent/child grouping based on parent_only flag
		purchase_invoice_items = group_items_by_parent(purchase_invoice_items, parent_only)
		
		# Fetch all transit numbers in the child table 
		for transit in sales_invoice_doc.custom_transit_number:
			transit_number = {
				'document_type': transit.document_type,
				'company': transit.company,
				'transit_no': transit.transit_no,
				'cancelled_invoice': transit.cancelled_invoice,
			}
			transit_numbers.append(transit_number)
		
		frappe.log_error(f"Items fetched: {len(purchase_invoice_items)}", "Purchase Invoice Items")
		
		# If branch exists fetch it 
		if sales_invoice_doc.branch:
			branch = sales_invoice_doc.branch
		else:
			branch = ''
			
		marka = sales_invoice_doc.marka if sales_invoice_doc.marka else ''
		is_export_sale = sales_invoice_doc.custom_is_export_sale
		container_no = sales_invoice_doc.custom_container_no
		invoice_no = sales_invoice_doc.name
		bill_of_landing = sales_invoice_doc.custom_bill_of_landing
		bil = sales_invoice_doc.custom_bil
		port_of_loading = sales_invoice_doc.custom_port_of_loading
		port_of_discharge = sales_invoice_doc.custom_port_of_discharge
		destination = sales_invoice_doc.custom_destination
		estimated_date_of_departure = sales_invoice_doc.custom_estimated_date_of_departure
		estimated_date_of_arrival = sales_invoice_doc.custom_estimated_date_of_arrival
		
		shipping_details = {
			'is_export_sale': is_export_sale,
			'branch': branch,
			'marka': marka,
			'container_no': container_no,
			'invoice_no': invoice_no,
			'bill_of_landing': bill_of_landing,
			'port_of_loading': port_of_loading,
			'port_of_discharge': port_of_discharge,
			'destination': destination,
			'bil': bil,
			'estimated_date_of_departure': estimated_date_of_departure,
			'estimated_date_of_arrival': estimated_date_of_arrival
		}

		response_data = {
			'purchase_invoice_items': purchase_invoice_items,
			'shipping_details': shipping_details,
			'transit_numbers': transit_numbers
		}

		frappe.response['message'] = response_data

	except Exception as e:
		frappe.log_error(f"Error fetching items from Sales Invoice {selected_sales_invoice}: {str(e)[:140]}", "Sales Invoice Fetch Error")
		frappe.throw(f"Error fetching items from Sales Invoice {selected_sales_invoice}: {str(e)[:140]}")


@frappe.whitelist()
def get_items_from_selected_purchase_invoice(purchase_invoice, company, parent_only=False):
	"""
	Get items from Purchase Invoice for Sales Invoice
	Supports parent/child item grouping
	"""
	selected_purchase_invoice = purchase_invoice
	company = company
	# Properly convert checkbox value to boolean
	parent_only = parent_only in (True, 1, "1", "true", "True")

	sales_invoice_items = []
	transit_numbers = []

	try:
		# Retrieve the selected Purchase Invoice document
		purchase_invoice_doc = frappe.get_doc("Purchase Invoice", selected_purchase_invoice)
		
		# Iterate over items in the Purchase Invoice and add them to the Sales Invoice items list
		for item in purchase_invoice_doc.items:
			# Calculate the rate and amount based on item properties and additional logic
			calculated_rate = (item.landed_cost_voucher_amount / item.qty) + item.rate if item.qty else item.rate
			calculated_amount = calculated_rate * item.qty
			
			# Retrieve the income account associated with the item
			income_account = get_accounts(item.item_code, company)
			expense_account = get_expense_accounts(item.item_code, company)
			
			# Create a dictionary representing each item with additional details
			item_details = {
				'item_code': item.item_code,
				'item_name': item.item_name,
				'qty': item.custom_outward_qty or item.qty,
				'rate': calculated_rate,
				'amount': calculated_amount,
				'uom': item.uom,
				'stock_uom': item.stock_uom,
				'custom_containers': item.custom_containers,
				'custom_cartons': item.custom_cartons,
				'income_account': income_account,
				'expense_account': expense_account,
				"custom_item_identifier": item.custom_item_identifier
			}
			
			sales_invoice_items.append(item_details)
		
		# Apply parent/child grouping based on parent_only flag
		sales_invoice_items = group_items_by_parent(sales_invoice_items, parent_only)
		
		# Fetch all transit numbers in the child table 
		for transit in purchase_invoice_doc.custom_transit_number:
			transit_number = {
				'document_type': transit.document_type,
				'company': transit.company,
				'transit_no': transit.transit_no,
				'cancelled_invoice': transit.cancelled_invoice,
			}
			transit_numbers.append(transit_number)
		
		# If branch exists fetch it 
		if purchase_invoice_doc.branch:
			branch = purchase_invoice_doc.branch
		else:
			branch = ''
			
		marka = purchase_invoice_doc.marka if purchase_invoice_doc.marka else ''
		
		# Fetch shipping details from selected_purchase_invoice
		is_export_sale = purchase_invoice_doc.custom_is_export_sale
		container_no = purchase_invoice_doc.custom_container_no
		invoice_no = purchase_invoice_doc.name
		bill_of_landing = purchase_invoice_doc.custom_bill_of_landing
		port_of_loading = purchase_invoice_doc.custom_port_of_loading
		port_of_discharge = purchase_invoice_doc.custom_port_of_discharge
		destination = purchase_invoice_doc.custom_destination
		bil = purchase_invoice_doc.custom_bil
		estimated_date_of_departure = purchase_invoice_doc.custom_estimated_date_of_departure
		estimated_date_of_arrival = purchase_invoice_doc.custom_estimated_date_of_arrival
		
		# Create a dictionary representing the values above
		shipping_details = {
			'is_export_sale': is_export_sale,
			'branch': branch,
			'marka': marka,
			'container_no': container_no,
			'invoice_no': invoice_no,
			'bill_of_landing': bill_of_landing,
			'port_of_loading': port_of_loading,
			'port_of_discharge': port_of_discharge,
			'destination': destination,
			'bil': bil,
			'estimated_date_of_departure': estimated_date_of_departure,
			'estimated_date_of_arrival': estimated_date_of_arrival
		}
		
		response_data = {
			'sales_invoice_items': sales_invoice_items,
			'shipping_details': shipping_details,
			'transit_numbers': transit_numbers
		}
		
		# Set the response message to the list of item dictionaries
		frappe.response['message'] = response_data

	except Exception as e:
		frappe.log_error(f"Error fetching items from Purchase Invoice {selected_purchase_invoice}: {str(e)}", "Purchase Invoice Fetch Error")
		frappe.throw(f"Error fetching items from Purchase Invoice {selected_purchase_invoice}: {str(e)}")

