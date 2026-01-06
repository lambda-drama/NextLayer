# Copyright (c) 2025, Next Layer and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from erpnext.setup.utils import get_exchange_rate
from erpnext.setup.utils import get_exchange_rate


@frappe.whitelist()
def create_additional_travel_expense(original_travel_expense, expense_items, company=None, traveler_name=None, transaction_currency=None):
	"""
	Create a new Travel Expense as an additional expense linked to the original
	
	Args:
		original_travel_expense: Name of the original Travel Expense
		expense_items: List of travel expense detail items
		company: Company (optional, will use from original if not provided)
		traveler_name: Traveler Name (optional, will use from original if not provided)
		transaction_currency: Transaction currency from modal (optional)
	
	Returns:
		dict: Success status and travel expense name
	"""
	try:
		# Parse expense_items if it's a JSON string
		if isinstance(expense_items, str):
			import json
			expense_items = json.loads(expense_items)
		
		# Get original travel expense
		original_te = frappe.get_doc("Travel Expense", original_travel_expense)
		
		# Get company currency
		company_currency = frappe.get_cached_value("Company", company or original_te.company, "default_currency")
		
		# Set transaction currency (use provided currency or default to company currency)
		if not transaction_currency:
			transaction_currency = getattr(original_te, 'currency', None) or company_currency
		
		# Create new travel expense - copy all relevant fields from original
		new_te_data = {
			"doctype": "Travel Expense",
			"traveler_name": traveler_name or original_te.traveler_name,
			"company": company or original_te.company,
			"currency": transaction_currency,  # Set transaction currency
			"is_addition": 1,
			"travel_group": original_te.travel_group,
			"posting_date": frappe.utils.today(),
			"original_expense": original_te.name,
		}
		
		# Copy mandatory accounting dimension fields from original
		# Use getattr to safely get field values even if they don't exist
		company_group = getattr(original_te, 'company_group', None)
		if company_group:
			new_te_data["company_group"] = company_group
		
		branch = getattr(original_te, 'branch', None)
		if branch:
			new_te_data["branch"] = branch
		
		marka = getattr(original_te, 'marka', None)
		if marka:
			new_te_data["marka"] = marka
		
		# Copy other common fields that might be needed
		payable_account = getattr(original_te, 'payable_account', None)
		if payable_account:
			new_te_data["payable_account"] = payable_account
		
		cost_center = getattr(original_te, 'cost_center', None)
		if cost_center:
			new_te_data["cost_center"] = cost_center
		
		project = getattr(original_te, 'project', None)
		if project:
			new_te_data["project"] = project
		
		# Create new travel expense
		new_te = frappe.get_doc(new_te_data)
		
		# Add expense items
		for item in expense_items:
			# Ensure item is a dict - handle different input formats
			if isinstance(item, str):
				import json
				try:
					item = json.loads(item)
				except:
					item = {}
			elif not isinstance(item, dict):
				# Try to convert to dict if it's not already
				try:
					if hasattr(item, '__dict__'):
						item = dict(item)
					elif hasattr(item, 'keys'):
						item = dict(item)
					else:
						item = {}
				except:
					item = {}
			
			# Helper function to safely get values
			def safe_get(data, key, default=None):
				if isinstance(data, dict):
					return data.get(key, default)
				elif hasattr(data, key):
					return getattr(data, key, default)
				return default
			
			# Get amount and amount_company_currency from item
			amount = safe_get(item, "amount", 0)
			amount_company_currency = safe_get(item, "amount_company_currency")
			
			expense_detail = {
				"expense_type": safe_get(item, "expense_type"),
				"expense_date": safe_get(item, "expense_date") or frappe.utils.today(),
				"amount": amount,
				"amount_company_currency": amount_company_currency,  # Set company currency amount if provided
				"sanctioned_amount": safe_get(item, "sanctioned_amount") or amount,
				"cost_center": safe_get(item, "cost_center"),
				"project": safe_get(item, "project"),
				"company": safe_get(item, "company") or new_te.company,
				"description": safe_get(item, "description"),
				# PRN Number
				"custom_prn_number": safe_get(item, "custom_prn_number") or "",
				# Hotel fields
				"hotel_checkin_date": safe_get(item, "hotel_checkin_date"),
				"hotel_checkout_date": safe_get(item, "hotel_checkout_date"),
				"purpose": safe_get(item, "purpose"),
				"hotel_territory": safe_get(item, "hotel_territory"),
				"hotel_location": safe_get(item, "hotel_location"),
				"hotel_city": safe_get(item, "hotel_city"),
				"hotel_country": safe_get(item, "hotel_country"),
				"custom_hotel_name": safe_get(item, "custom_hotel_name"),
				"total_nights": safe_get(item, "total_nights"),
				"rate_per_day": safe_get(item, "rate_per_day"),
				# Travel custom fields
				"custom_flight_no": safe_get(item, "custom_flight_no"),
				"custom_date_of_purchase": safe_get(item, "custom_date_of_purchase"),
				"custom_travel_type": safe_get(item, "custom_travel_type"),
				"custom_booked_by": safe_get(item, "custom_booked_by"),
				"custom_departure_airport": safe_get(item, "custom_departure_airport"),
				"custom_arrival_airport": safe_get(item, "custom_arrival_airport"),
				"custom_airlines": safe_get(item, "custom_airlines"),
				"custom_date_of_travel": safe_get(item, "custom_date_of_travel"),
				"custom_date_of_arrival": safe_get(item, "custom_date_of_arrival"),
			}
			
			# Remove None values (but keep empty strings and 0)
			expense_detail = {k: v for k, v in expense_detail.items() if v is not None}
			
			# Append the expense detail
			new_te.append("expenses", expense_detail)
		
		# Insert and save
		new_te.insert(ignore_permissions=True)
		
		# Recalculate totals first
		new_te.calculate_totals()
		
		# Note: Amounts from modal are in transaction currency, need to convert to company currency
		if new_te.expenses:
			company_currency = frappe.get_cached_value("Company", new_te.company, "default_currency")
			transaction_currency = getattr(new_te, 'currency', None) or company_currency
			
			if transaction_currency != company_currency:
				# Different currencies - convert amounts from transaction currency to company currency
				for expense in new_te.expenses:
					if expense.amount:
						# if not expense.amount_company_currency:
						try:
							transaction_date = expense.expense_date or new_te.posting_date or frappe.utils.today()
							exchange_rate = get_exchange_rate(
								transaction_currency,
								company_currency,
								transaction_date,
								new_te.company
							)
							
							# expense.amount is in transaction currency, convert to company currency
							expense.amount_company_currency = expense.amount * exchange_rate
							
						except Exception as e:
							# If conversion fails, use same amount and log error
							frappe.log_error(f"Error converting amount for expense: {str(e)}", "Travel Expense Currency Conversion")
							expense.amount_company_currency = expense.amount
				
			else:
				# Same currency, set amount_company_currency = amount
				for expense in new_te.expenses:
					if expense.amount and not expense.amount_company_currency:
						expense.amount_company_currency = expense.amount
		
		# Recalculate totals again after setting amount_company_currency
		new_te.calculate_totals()
		new_te.save(ignore_permissions=True)
		new_te.submit()
		frappe.db.commit()
		
		return {
			"success": True,
			"travel_expense_name": new_te.name,
		}
		
	except Exception as e:
		frappe.log_error(f"Error creating additional travel expense: {str(e)}", "Travel Expense Utils Error")
		return {
			"success": False,
			"error": str(e),
		}


def create_journal_entry_for_travel_expense(travel_expense):
	"""
	Create a Journal Entry to book the travel expense when is_paid is NOT ticked.
	
	Creates a single Journal Entry with 2 account rows:
	1. Dr: Expense Account(s) - from expenses child table
	2. Cr: Payable Account (you owe this money)
	
	When is_paid = 0, the expense is not yet paid, so we record it as a payable.
	
	Args:
		travel_expense: Travel Expense document
	
	Returns:
		str: Journal Entry name
	"""
	try:
		# Check if is_paid is ticked
		is_paid = getattr(travel_expense, 'is_paid', 0)
		
		# If is_paid is ticked, don't use this function (use create_journal_entry_for_paid_travel_expense instead)
		if is_paid:
			return None
		
		# Get company details
		company = travel_expense.company
		company_doc = frappe.get_doc("Company", company)
		company_currency = company_doc.default_currency
		
		# Get transaction currency
		transaction_currency = getattr(travel_expense, 'currency', None) or company_currency
		
		# Get payable account from travel expense or company default
		payable_account = travel_expense.payable_account
		if not payable_account:
			# Try to get from company defaults
			payable_account = frappe.db.get_value("Company", company, "default_payable_account")
		
		if not payable_account:
			frappe.throw(_("Please set Payable Account in Travel Expense or Company settings"))
		
		# Get payable account currency
		payable_account_currency = frappe.db.get_value("Account", payable_account, "account_currency") or company_currency
		
		# Ensure totals are calculated before creating journal entry
		if hasattr(travel_expense, 'calculate_totals'):
			travel_expense.calculate_totals()
		
		# Get total amount (use company currency amount)
		total_amount = getattr(travel_expense, 'grand_total_company_currency', None) or getattr(travel_expense, 'total_company_currency', None) or 0
		
		if total_amount <= 0:
			frappe.throw(_("Cannot create journal entry: Travel expense grand total is zero or negative. Please ensure expenses are added and amounts are set."))
		
		# Get posting date
		posting_date = getattr(travel_expense, 'posting_date', None) or frappe.utils.today()
		
		# Get traveler (Member) for party
		traveler = getattr(travel_expense, 'traveler_name', None)
		
		# Build expense account entries from expenses child table
		if not travel_expense.expenses:
			frappe.throw(_("No expenses found. Please add expenses before submitting."))
		
		# Get company default expense account
		expense_account = company_doc.default_expense_account
		if not expense_account:
			frappe.throw(_("No expense account found. Please set Default Expense Account in Company settings."))
		
		# Validate all expense rows have expense type
		for expense_row in travel_expense.expenses:
			expense_type = expense_row.expense_type
			if not expense_type:
				frappe.throw(_("Expense Type is required for all expense rows"))
		
		# Use total amount for expense account (all expenses go to same account)
		expense_accounts = {expense_account: total_amount}
		
		# Build journal entry accounts list
		je_accounts = []
		
		# 1. Debit Expense Account(s)
		for expense_account, amount in expense_accounts.items():
			expense_account_currency = frappe.db.get_value("Account", expense_account, "account_currency") or company_currency
			
			# Calculate base amount
			if expense_account_currency == company_currency:
				expense_base_amount = amount
			else:
				try:
					exchange_rate = get_exchange_rate(
						expense_account_currency,
						company_currency,
						posting_date,
						company
					)
					expense_base_amount = amount * exchange_rate
				except Exception:
					expense_base_amount = amount
			
			# Get cost center and project from first expense row, or from main form
			cost_center = travel_expense.cost_center
			project = travel_expense.project
			# Try to get from first expense row
			if travel_expense.expenses and len(travel_expense.expenses) > 0:
				first_expense_row = travel_expense.expenses[0]
				if first_expense_row.cost_center:
					cost_center = first_expense_row.cost_center
				if first_expense_row.project:
					project = first_expense_row.project
			
			je_accounts.append({
				"account": expense_account,
				"debit_in_account_currency": amount,
				"debit": expense_base_amount,
				"cost_center": cost_center,
				"project": project,
				"custom_travel_expense_ref": travel_expense.name,
			})
		
		# 2. Credit Payable Account
		if payable_account_currency == company_currency:
			payable_base_amount = total_amount
			payable_amount = total_amount
		else:
			# Payable account is in different currency
			try:
				# Get exchange rate from company currency to payable account currency
				payable_exchange_rate = get_exchange_rate(
					company_currency,
					payable_account_currency,
					posting_date,
					company
				)
				payable_amount = total_amount * payable_exchange_rate
				# Base amount is in company currency
				payable_base_amount = total_amount
			except Exception:
				# If exchange rate not found, use same amount
				payable_amount = total_amount
				payable_base_amount = total_amount
		
		je_accounts.append({
			"account": payable_account,
			"credit_in_account_currency": payable_amount,
			"credit": payable_base_amount,
			"party_type": "Member" if traveler else None,
			"party": traveler if traveler else None,
			"cost_center": travel_expense.cost_center,
			"project": travel_expense.project,
			"custom_travel_expense_ref": travel_expense.name,
		})
		
		# Determine if multi-currency
		expense_account_currency = frappe.db.get_value("Account", expense_account, "account_currency") or company_currency
		is_multi_currency = (
			expense_account_currency != company_currency or 
			payable_account_currency != company_currency
		)
		
		# Create Journal Entry
		je = frappe.get_doc({
			"doctype": "Journal Entry",
			"voucher_type": "Journal Entry",
			"company": company,
			"posting_date": posting_date,
			"multi_currency": 1 if is_multi_currency else 0,
			"user_remark": f"Travel Expense {travel_expense.name} - Unpaid Expense",
			"accounts": je_accounts
		})
		
		# Set currency for journal entry if multi-currency
		if is_multi_currency:
			# Use expense account currency as primary, or company currency
			primary_currency = expense_account_currency if expense_account_currency != company_currency else company_currency
			je.currency = primary_currency
			if primary_currency != company_currency:
				try:
					je.exchange_rate = get_exchange_rate(
						primary_currency,
						company_currency,
						posting_date,
						company
					)
				except Exception:
					je.exchange_rate = 1
		
		# Add accounting dimensions if present
		if hasattr(travel_expense, 'company_group') and travel_expense.company_group:
			je.company_group = travel_expense.company_group
		if hasattr(travel_expense, 'branch') and travel_expense.branch:
			je.branch = travel_expense.branch
		
		# Insert and submit the journal entry
		je.insert(ignore_permissions=True)
		je.submit()
		frappe.db.commit()
		
		return je.name
		
	except Exception as e:
		frappe.log_error(f"Error creating journal entry: {str(e)}", "Travel Expense Utils Error")
		raise


def create_journal_entry_for_paid_travel_expense(travel_expense):
	"""
	Create a Journal Entry to book the travel expense when is_paid is ticked.
	
	Creates a single Journal Entry with 2 account rows:
	1. Dr: Expense Account(s) - from expenses child table
	2. Cr: Direct Payment Account (bank/cash that paid the expense)
	
	When is_paid = 1, the payment already happened, so we don't need to go through
	payable account. We directly record the expense against the payment account.
	
	Args:
		travel_expense: Travel Expense document
	
	Returns:
		str: Journal Entry name
	"""
	try:
		# Validate required fields
		if not travel_expense.direct_payment_account:
			frappe.throw(_("Direct Payment Account is required when 'Is Paid' is ticked"))
		
		# Get company details
		company = travel_expense.company
		company_doc = frappe.get_doc("Company", company)
		company_currency = company_doc.default_currency
		
		# Get transaction currency
		transaction_currency = getattr(travel_expense, 'currency', None) or company_currency
		
		# Ensure totals are calculated
		if hasattr(travel_expense, 'calculate_totals'):
			travel_expense.calculate_totals()
		
		# Get total amount (use company currency amount)
		total_amount = getattr(travel_expense, 'grand_total_company_currency', None) or getattr(travel_expense, 'total_company_currency', None) or 0
		
		if total_amount <= 0:
			frappe.throw(_("Cannot create journal entry: Travel expense grand total is zero or negative. Please ensure expenses are added and amounts are set."))
		
		# Get direct payment account
		direct_payment_account = travel_expense.direct_payment_account
		
		# Get account currencies
		direct_payment_account_currency = frappe.db.get_value("Account", direct_payment_account, "account_currency") or company_currency
		
		# Get posting date
		posting_date = getattr(travel_expense, 'posting_date', None) or frappe.utils.today()
		
		# Build expense account entries from expenses child table
		if not travel_expense.expenses:
			frappe.throw(_("No expenses found. Please add expenses before submitting."))
		
		# Get company default expense account
		expense_account = company_doc.default_expense_account
		if not expense_account:
			frappe.throw(_("No expense account found. Please set Default Expense Account in Company settings."))
		
		# Validate all expense rows have expense type
		for expense_row in travel_expense.expenses:
			expense_type = expense_row.expense_type
			if not expense_type:
				frappe.throw(_("Expense Type is required for all expense rows"))
		
		# Use total amount for expense account (all expenses go to same account)
		expense_accounts = {expense_account: total_amount}
		
		# Build journal entry accounts list
		je_accounts = []
		
		# 1. Debit Expense Account(s)
		for expense_account, amount in expense_accounts.items():
			expense_account_currency = frappe.db.get_value("Account", expense_account, "account_currency") or company_currency
			
			# Calculate base amount
			if expense_account_currency == company_currency:
				expense_base_amount = amount
			else:
				try:
					exchange_rate = get_exchange_rate(
						expense_account_currency,
						company_currency,
						posting_date,
						company
					)
					expense_base_amount = amount * exchange_rate
				except Exception:
					expense_base_amount = amount
			
			# Get cost center and project from first expense row, or from main form
			cost_center = travel_expense.cost_center
			project = travel_expense.project
			# Try to get from first expense row
			if travel_expense.expenses and len(travel_expense.expenses) > 0:
				first_expense_row = travel_expense.expenses[0]
				if first_expense_row.cost_center:
					cost_center = first_expense_row.cost_center
				if first_expense_row.project:
					project = first_expense_row.project
			
			je_accounts.append({
				"account": expense_account,
				"debit_in_account_currency": amount,
				"debit": expense_base_amount,
				"cost_center": cost_center,
				"project": project,
				"custom_travel_expense_ref": travel_expense.name,
			})
		
		# 2. Credit Direct Payment Account
		if direct_payment_account_currency == company_currency:
			payment_base_amount = total_amount
			payment_amount = total_amount
		else:
			# Direct payment account is in different currency
			try:
				# Get exchange rate from company currency to payment account currency
				payment_exchange_rate = get_exchange_rate(
					company_currency,
					direct_payment_account_currency,
					posting_date,
					company
				)
				payment_amount = total_amount * payment_exchange_rate
				# Base amount is in company currency
				payment_base_amount = total_amount
			except Exception:
				# If exchange rate not found, use same amount
				payment_amount = total_amount
				payment_base_amount = total_amount
		
		je_accounts.append({
			"account": direct_payment_account,
			"credit_in_account_currency": payment_amount,
			"credit": payment_base_amount,
			"cost_center": travel_expense.cost_center,
			"project": travel_expense.project,
			"custom_travel_expense_ref": travel_expense.name,
		})
		
		# Determine if multi-currency
		expense_account_currency = frappe.db.get_value("Account", expense_account, "account_currency") or company_currency
		is_multi_currency = (
			expense_account_currency != company_currency or 
			direct_payment_account_currency != company_currency
		)
		
		# Create Journal Entry
		je = frappe.get_doc({
			"doctype": "Journal Entry",
			"voucher_type": "Journal Entry",
			"company": company,
			"posting_date": posting_date,
			"multi_currency": 1 if is_multi_currency else 0,
			"user_remark": f"Travel Expense {travel_expense.name} - Paid Expense",
			"accounts": je_accounts
		})
		
		# Set currency for journal entry if multi-currency
		if is_multi_currency:
			# Use expense account currency as primary, or company currency
			primary_currency = expense_account_currency if expense_account_currency != company_currency else company_currency
			je.currency = primary_currency
			if primary_currency != company_currency:
				try:
					je.exchange_rate = get_exchange_rate(
						primary_currency,
						company_currency,
						posting_date,
						company
					)
				except Exception:
					je.exchange_rate = 1
		
		# Add accounting dimensions
		if hasattr(travel_expense, 'company_group') and travel_expense.company_group:
			je.company_group = travel_expense.company_group
		if hasattr(travel_expense, 'branch') and travel_expense.branch:
			je.branch = travel_expense.branch
		
		# Insert and submit the journal entry
		je.insert(ignore_permissions=True)
		je.submit()
		frappe.db.commit()
		
		return je.name
		
	except Exception as e:
		frappe.log_error(f"Error creating journal entry for paid travel expense: {str(e)}", "Travel Expense Utils Error")
		raise

