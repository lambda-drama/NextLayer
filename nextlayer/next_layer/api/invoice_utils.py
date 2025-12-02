# Copyright (c) 2025, jr@gmail.com and contributors
# For license information, please see license.txt

import frappe
from collections import defaultdict


def get_accounts(item_code, company):
	"""Get income account for item from item defaults or company defaults"""
	try:
		item_doc = frappe.get_doc("Item", item_code)
		item_defaults = item_doc.get("item_defaults")

		# First, try to get income account from item defaults
		if item_defaults:
			for default in item_defaults:
				if default.get("company") == company:
					# Check if income_account is set in item default
					if default.get("income_account"):
						return default.get("income_account")
		
		# Fallback: Get from company defaults
		if company:
			try:
				company_doc = frappe.get_doc("Company", company)
				if company_doc.default_income_account:
					return company_doc.default_income_account
			except Exception:
				pass

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


@frappe.whitelist()
def check_invoice_number_exists(invoice_number, doctype, current_docname=None):
	"""Check if an invoice with the given invoice number already exists"""
	try:
		if not invoice_number:
			return False
		
		# Build filters to check for existing invoice with same number
		filters = {
			'custom_invoice_no': invoice_number
		}
		
		# Exclude the current document if editing
		if current_docname:
			filters['name'] = ['!=', current_docname]
		
		# Check if any invoice exists with this number
		existing_invoice = frappe.db.exists(doctype, filters)
		
		if existing_invoice:
			return {
				'exists': True,
				'invoice_name': existing_invoice
			}
		
		return {
			'exists': False,
			'invoice_name': None
		}
		
	except Exception as e:
		frappe.log_error(f"Error checking invoice number: {str(e)}", "Invoice Number Check Error")
		return {
			'exists': False,
			'invoice_name': None
		}


@frappe.whitelist()
def check_mandatory_accounting_dimensions(company):
	"""Check which accounting dimensions are mandatory for a company based on dimension defaults"""
	try:
		# Validate company parameter
		if not company:
			return {
				'branch': False,
				'company_group': False,
				'marka': False
			}
		
		mandatory_fields = {
			'branch': False,
			'company_group': False,
			'marka': False
		}
		
		# Get all accounting dimensions
		accounting_dimensions = frappe.get_all("Accounting Dimension",
			filters={"disabled": 0},
			fields=["name", "document_type", "fieldname"]
		)
		
		# Check each dimension for mandatory_for_bs in Dimension Defaults
		for dim in accounting_dimensions:
			if dim.document_type in ["Branch", "Company Group", "Marka"]:
				# Try direct SQL query first (more reliable for child tables)
				try:
					dim_defaults = frappe.db.sql("""
						SELECT mandatory_for_bs 
						FROM `tabDimension Defaults`
						WHERE parent = %s AND company = %s AND mandatory_for_bs = 1
						LIMIT 1
					""", (dim.name, company), as_dict=True)
					
					if dim_defaults:
						# This dimension is mandatory for this company
						if dim.document_type == "Branch":
							mandatory_fields['branch'] = True
						elif dim.document_type == "Company Group":
							mandatory_fields['company_group'] = True
						elif dim.document_type == "Marka":
							mandatory_fields['marka'] = True
						continue
				except Exception as sql_error:
					frappe.log_error(f"SQL error checking dimension {dim.name}: {str(sql_error)}", "Dimension Check Error")
				
				# Fallback: Get the full Accounting Dimension document to access child table
				try:
					dim_doc = frappe.get_doc("Accounting Dimension", dim.name)
					
					# Check Dimension Defaults child table (try different possible field names)
					child_table = None
					if hasattr(dim_doc, 'dimension_defaults'):
						child_table = dim_doc.dimension_defaults
					elif hasattr(dim_doc, 'defaults'):
						child_table = dim_doc.defaults
					
					if child_table:
						for default in child_table:
							if default.company == company and getattr(default, 'mandatory_for_bs', 0) == 1:
								# This dimension is mandatory for this company
								if dim.document_type == "Branch":
									mandatory_fields['branch'] = True
								elif dim.document_type == "Company Group":
									mandatory_fields['company_group'] = True
								elif dim.document_type == "Marka":
									mandatory_fields['marka'] = True
								break
				except Exception as dim_error:
					frappe.log_error(f"Error checking dimension {dim.name}: {str(dim_error)}", "Dimension Check Error")
					continue
		
		return mandatory_fields
		
	except Exception as e:
		frappe.log_error(f"Error checking mandatory accounting dimensions: {str(e)}", "Accounting Dimension Check Error")
		return {
			'branch': False,
			'company_group': False,
			'marka': False
		}


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
			'custom_item_identifier': None,
			'rates': []  # Track all rates to check if they're the same
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

			# Always prefer the transaction's UOM.
			transaction_uom = item.get('uom')
			if transaction_uom:
				parent_group['uom'] = transaction_uom
			elif not parent_group['uom']:
				# Fall back to the parent's sales UOM or stock UOM only if transaction UOM is missing
				try:
					parent_doc = parent_doc if 'parent_doc' in locals() and parent_doc.name == parent_item else frappe.get_cached_doc("Item", parent_item)
					parent_group['uom'] = getattr(parent_doc, 'sales_uom', None) or parent_doc.stock_uom
				except Exception:
					parent_group['uom'] = item.get('uom') or item.get('stock_uom')
			
			# Get item rate and track it
			item_rate = item.get('rate', 0) or 0
			if item_rate > 0:
				parent_groups[parent_item]['rates'].append(item_rate)
			
			# Accumulate quantities and amounts
			parent_group['qty'] += item.get('qty', 0) or 0
			parent_group['amount'] += item.get('amount', 0) or 0
			parent_group['custom_containers'] += item.get('custom_containers', 0) or 0
			parent_group['custom_cartons'] += item.get('custom_cartons', 0) or 0
			parent_group['stock_qty'] += item.get('stock_qty', 0) or 0
			parent_group['income_account'] = parent_group['income_account'] or item.get('income_account')
			parent_group['expense_account'] = parent_group['expense_account'] or item.get('expense_account')
		else:
			# This is already a parent item, add as is
			processed_items.append(item)
	
	# Process parent groups and calculate rates
	for parent_item, group_data in parent_groups.items():
		# Calculate rate based on whether all child rates are the same
		if group_data['qty'] > 0:
			rates = group_data['rates']
			if rates:
				# Check if all rates are the same (with tolerance for floating point precision)
				# Round to 2 decimal places for comparison
				rounded_rates = [round(rate, 2) for rate in rates]
				if len(set(rounded_rates)) == 1:
					# All rates are the same, use that rate
					group_data['rate'] = rates[0]
				else:
					# Different rates, calculate weighted average: total amount / total quantity
					group_data['rate'] = group_data['amount'] / group_data['qty']
			else:
				# No rates found, calculate from amount and quantity
				group_data['rate'] = group_data['amount'] / group_data['qty'] if group_data['qty'] > 0 else 0
		
		# Remove the 'rates' key before adding to processed items
		group_data.pop('rates', None)
		processed_items.append(group_data)
	
	return processed_items


@frappe.whitelist()
def get_items_from_selected_sal_invoice(sales_invoice, company=None, parent_only=False):
	"""
	Get items from Sales Invoice for Purchase Invoice
	Supports parent/child item grouping
	"""
	selected_sales_invoice = sales_invoice
	# Properly convert checkbox value to boolean
	parent_only = parent_only in (True, 1, "1", "true", "True")

	# Log the selected sales invoice and company for debugging
	frappe.log_error(f"Selected Sales Invoice: {selected_sales_invoice}", "Debugging")
	frappe.log_error(f"Selected Company: {company}", "Debugging")
	frappe.log_error(f"Parent Only: {parent_only}", "Debugging")

	if not selected_sales_invoice:
		frappe.throw("Sales invoice is not provided or is invalid.")

	purchase_invoice_items = []
	transit_numbers = []

	try:
		sales_invoice_doc = frappe.get_doc("Sales Invoice", selected_sales_invoice)
		
		# Determine target company (customer from Sales Invoice, which becomes Purchase Invoice's company)
		# Always use the customer from Sales Invoice as the company for Purchase Invoice
		# This ensures consistency regardless of what company is passed from the frontend
		target_company = sales_invoice_doc.customer
		
		# Always use target_company for Purchase Invoice (ignore the passed company parameter)
		# Company = customer from Sales Invoice
		company = target_company
		
		# Final validation
		if not company:
			frappe.throw("Company is not provided or is invalid.")
		
		# Ensure the sales invoice is submitted before proceeding
		if sales_invoice_doc.docstatus != 1:
			frappe.throw(f"Selected sales invoice must be submitted.")
		
		frappe.log_error(f"Fetched Sales Invoice: {selected_sales_invoice}", "Sales Invoice Document")
		
		# Use target_company (customer) for fetching expense accounts, as that's the company that will be used on Purchase Invoice
		# This ensures expense accounts belong to the correct company
		account_company = target_company if target_company else company
		
		for item in sales_invoice_doc.items:
			income_account = get_accounts(item.item_code, account_company)
			expense_account = get_expense_accounts(item.item_code, account_company)
			
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
		
		# Determine target company (customer from Sales Invoice, which becomes Purchase Invoice's company)
		target_company = sales_invoice_doc.customer
		
		# If branch exists, validate it belongs to target company before including it
		branch = ''
		if sales_invoice_doc.branch:
			try:
				branch_company = frappe.db.get_value("Branch", sales_invoice_doc.branch, "custom_company")
				# Only include branch if it belongs to the target company
				if branch_company == target_company:
					branch = sales_invoice_doc.branch
			except Exception:
				# If branch doesn't exist or error, leave branch empty
				pass
			
		marka = sales_invoice_doc.marka if sales_invoice_doc.marka else ''
		is_export_sale = sales_invoice_doc.custom_is_export_sale
		shipping_mode = getattr(sales_invoice_doc, 'custom_shipping_mode', '') or ''
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
			'estimated_date_of_arrival': estimated_date_of_arrival,
			'shipping_mode': shipping_mode
		}

		response_data = {
			'purchase_invoice_items': purchase_invoice_items,
			'shipping_details': shipping_details,
			'transit_numbers': transit_numbers
		}
		
		# Always include company and supplier info for autofill (regardless of parent_only)
		# Company = customer from Sales Invoice, Supplier = company from Sales Invoice
		response_data['company'] = sales_invoice_doc.customer
		response_data['supplier'] = sales_invoice_doc.company

		frappe.response['message'] = response_data

	except Exception as e:
		frappe.log_error(f"Error fetching items from Sales Invoice {selected_sales_invoice}: {str(e)[:140]}", "Sales Invoice Fetch Error")
		frappe.throw(f"Error fetching items from Sales Invoice {selected_sales_invoice}: {str(e)[:140]}")


@frappe.whitelist()
def get_items_from_selected_purchase_invoice(purchase_invoice, company=None, parent_only=False):
	"""
	Get items from Purchase Invoice for Sales Invoice
	Supports parent/child item grouping
	"""
	selected_purchase_invoice = purchase_invoice
	# Properly convert checkbox value to boolean
	parent_only = parent_only in (True, 1, "1", "true", "True")

	sales_invoice_items = []
	transit_numbers = []

	try:
		# Retrieve the selected Purchase Invoice document
		purchase_invoice_doc = frappe.get_doc("Purchase Invoice", selected_purchase_invoice)
		
		# Determine target company (supplier from Purchase Invoice, which becomes Sales Invoice's company)
		# Always use the supplier from Purchase Invoice as the company for Sales Invoice
		# This ensures consistency regardless of what company is passed from the frontend
		target_company = purchase_invoice_doc.supplier
		
		# Always use target_company for Sales Invoice (ignore the passed company parameter)
		# Company = supplier from Purchase Invoice
		company = target_company
		
		# Final validation
		if not company:
			frappe.throw("Company is not provided or is invalid.")
		
		# Use target_company (supplier) for fetching income accounts, as that's the company that will be used on Sales Invoice
		# This ensures income accounts belong to the correct company
		account_company = target_company if target_company else company
		
		# Iterate over items in the Purchase Invoice and add them to the Sales Invoice items list
		for item in purchase_invoice_doc.items:
			# Calculate the rate and amount based on item properties and additional logic
			calculated_rate = (item.landed_cost_voucher_amount / item.qty) + item.rate if item.qty else item.rate
			calculated_amount = calculated_rate * item.qty
			
			# Retrieve the income account associated with the item using the target company (supplier)
			income_account = get_accounts(item.item_code, account_company)
			expense_account = get_expense_accounts(item.item_code, account_company)
			
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
		
		# After grouping, ensure income accounts are set for all items (especially parent items)
		# This is important because when child items are grouped into parent items,
		# the parent item might not have an income_account set
		# Use target_company (supplier) for fetching accounts, as that's the company that will be used on Sales Invoice
		for item in sales_invoice_items:
			if not item.get('income_account'):
				# Fetch income account from item code if missing
				item_code = item.get('item_code')
				if item_code and account_company:
					income_account = get_accounts(item_code, account_company)
					if income_account:
						item['income_account'] = income_account
					else:
						# If still no income account, try to get from company default
						try:
							company_doc = frappe.get_doc("Company", account_company)
							if company_doc.default_income_account:
								item['income_account'] = company_doc.default_income_account
						except Exception:
							pass
		
		# Fetch all transit numbers in the child table 
		for transit in purchase_invoice_doc.custom_transit_number:
			transit_number = {
				'document_type': transit.document_type,
				'company': transit.company,
				'transit_no': transit.transit_no,
				'cancelled_invoice': transit.cancelled_invoice,
			}
			transit_numbers.append(transit_number)
		
		# Determine target company (supplier from Purchase Invoice, which becomes Sales Invoice's company)
		target_company = purchase_invoice_doc.supplier
		
		# If branch exists, validate it belongs to target company before including it
		branch = ''
		if purchase_invoice_doc.branch:
			try:
				branch_company = frappe.db.get_value("Branch", purchase_invoice_doc.branch, "custom_company")
				# Only include branch if it belongs to the target company
				if branch_company == target_company:
					branch = purchase_invoice_doc.branch
			except Exception:
				# If branch doesn't exist or error, leave branch empty
				pass
			
		marka = purchase_invoice_doc.marka if purchase_invoice_doc.marka else ''
		
		# Fetch shipping details from selected_purchase_invoice
		is_export_sale = purchase_invoice_doc.custom_is_export_sale
		shipping_mode = getattr(purchase_invoice_doc, 'custom_shipping_mode', '') or ''
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
			'estimated_date_of_arrival': estimated_date_of_arrival,
			'shipping_mode': shipping_mode
		}
		
		response_data = {
			'sales_invoice_items': sales_invoice_items,
			'shipping_details': shipping_details,
			'transit_numbers': transit_numbers
		}
		
		# Always include company and customer info for autofill (regardless of parent_only)
		# Company = supplier from Purchase Invoice, Customer = company from Purchase Invoice
		response_data['company'] = purchase_invoice_doc.supplier
		response_data['customer'] = purchase_invoice_doc.company
		
		# Set the response message to the list of item dictionaries
		frappe.response['message'] = response_data

	except Exception as e:
		frappe.log_error(f"Error fetching items from Purchase Invoice {selected_purchase_invoice}: {str(e)}", "Purchase Invoice Fetch Error")
		frappe.throw(f"Error fetching items from Purchase Invoice {selected_purchase_invoice}: {str(e)}")

