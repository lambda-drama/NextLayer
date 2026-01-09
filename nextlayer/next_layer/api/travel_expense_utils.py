# Copyright (c) 2025, Next Layer and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from erpnext.setup.utils import get_exchange_rate
from erpnext.setup.utils import get_exchange_rate


def get_expense_account_from_expense_type(expense_type, company):
	"""
	Get expense account from Expense Claim Type based on expense type and company.
	Similar to how Expense Claim works.
	
	Args:
		expense_type: Name of the Expense Claim Type
		company: Company name
		
	Returns:
		str: Expense account name
		
	Raises:
		frappe.ValidationError: If expense account not found
	"""
	if not expense_type:
		frappe.throw(_("Expense Type is required"))
	
	if not company:
		frappe.throw(_("Company is required"))
	
	# Check if Expense Claim Type exists
	if not frappe.db.exists("Expense Claim Type", expense_type):
		frappe.throw(_("Expense Claim Type {0} does not exist").format(expense_type))
	
	# Get expense account from Expense Claim Type
	# Expense Claim Type has a child table "accounts" with company and default_account
	expense_account = frappe.db.sql("""
		SELECT default_account
		FROM `tabExpense Claim Account`
		WHERE parent = %s AND company = %s
		LIMIT 1
	""", (expense_type, company), as_dict=True)
	
	if expense_account and expense_account[0].get("default_account"):
		return expense_account[0].get("default_account")
	
	# If not found in child table, try to get from Expense Claim Type directly
	# Some setups might have default_account field directly on Expense Claim Type
	expense_account = frappe.db.get_value("Expense Claim Type", expense_type, "default_account")
	if expense_account:
		return expense_account
	
	# If still not found, throw error like Expense Claim does
	frappe.throw(_("Expense Account not found for Expense Claim Type {0} and Company {1}. Please set it in Expense Claim Type.").format(
		frappe.bold(expense_type), frappe.bold(company)
	))


@frappe.whitelist()
def create_additional_travel_expense(original_travel_expense, expense_items, company=None, traveler_name=None, transaction_currency=None, expense_category=None, cash_account=None):
	"""
	Create a new Travel Expense as an additional expense linked to the original
	
	Args:
		original_travel_expense: Name of the original Travel Expense
		expense_items: List of travel expense detail items
		company: Company (optional, will use from original if not provided)
		traveler_name: Traveler Name (optional, will use from original if not provided)
		transaction_currency: Transaction currency from modal (optional)
		expense_category: Expense category - "Refund" or "Update" (optional)
		cash_account: Cash/Bank account for lost amount in refunds (optional, will use company default if not provided)
	
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
		
		# Determine if this is a refund
		is_refund = expense_category == "Refund"
		
		# Create new travel expense - copy all relevant fields from original
		new_te_data = {
			"doctype": "Travel Expense",
			"traveler_name": traveler_name or original_te.traveler_name,
			"company": company or original_te.company,
			"currency": transaction_currency,  # Set transaction currency
			"is_addition": 1,
			"refund": 1 if is_refund else 0,  # Set refund field
			"travel_group": original_te.travel_group,
			"posting_date": frappe.utils.today(),
			"original_expense": original_te.name,
		}
		
		# Copy travel details from original (flight information)
		if hasattr(original_te, 'flight_no') and original_te.flight_no:
			new_te_data["flight_no"] = original_te.flight_no
		if hasattr(original_te, 'flight_no_2') and original_te.flight_no_2:
			new_te_data["flight_no_2"] = original_te.flight_no_2
		if hasattr(original_te, 'custom_departure_airport') and original_te.custom_departure_airport:
			new_te_data["custom_departure_airport"] = original_te.custom_departure_airport
		if hasattr(original_te, 'custom_arrival_airport') and original_te.custom_arrival_airport:
			new_te_data["custom_arrival_airport"] = original_te.custom_arrival_airport
		if hasattr(original_te, 'custom_airlines') and original_te.custom_airlines:
			new_te_data["custom_airlines"] = original_te.custom_airlines
		if hasattr(original_te, 'custom_date_of_travel') and original_te.custom_date_of_travel:
			new_te_data["custom_date_of_travel"] = original_te.custom_date_of_travel
		if hasattr(original_te, 'custom_date_of_arrival') and original_te.custom_date_of_arrival:
			new_te_data["custom_date_of_arrival"] = original_te.custom_date_of_arrival
		if hasattr(original_te, 'custom_date_of_purchase') and original_te.custom_date_of_purchase:
			new_te_data["custom_date_of_purchase"] = original_te.custom_date_of_purchase
		if hasattr(original_te, 'custom_booked_by') and original_te.custom_booked_by:
			new_te_data["custom_booked_by"] = original_te.custom_booked_by
		if hasattr(original_te, 'custom_travel_type') and original_te.custom_travel_type:
			new_te_data["custom_travel_type"] = original_te.custom_travel_type
		if hasattr(original_te, 'custom_pnr_number_') and original_te.custom_pnr_number_:
			new_te_data["custom_pnr_number_"] = original_te.custom_pnr_number_
		if hasattr(original_te, 'custom_departure_airport_2') and original_te.custom_departure_airport_2:
			new_te_data["custom_departure_airport_2"] = original_te.custom_departure_airport_2
		if hasattr(original_te, 'custom_arrival_airport_2') and original_te.custom_arrival_airport_2:
			new_te_data["custom_arrival_airport_2"] = original_te.custom_arrival_airport_2
		if hasattr(original_te, 'custom_date_of_travel_2') and original_te.custom_date_of_travel_2:
			new_te_data["custom_date_of_travel_2"] = original_te.custom_date_of_travel_2
		if hasattr(original_te, 'custom_date_of_arrival_2') and original_te.custom_date_of_arrival_2:
			new_te_data["custom_date_of_arrival_2"] = original_te.custom_date_of_arrival_2
		
		# Copy hotel details from original
		if hasattr(original_te, 'hotel_checkin_date') and original_te.hotel_checkin_date:
			new_te_data["hotel_checkin_date"] = original_te.hotel_checkin_date
		if hasattr(original_te, 'hotel_checkout_date') and original_te.hotel_checkout_date:
			new_te_data["hotel_checkout_date"] = original_te.hotel_checkout_date
		if hasattr(original_te, 'custom_hotel_name') and original_te.custom_hotel_name:
			new_te_data["custom_hotel_name"] = original_te.custom_hotel_name
		if hasattr(original_te, 'hotel_territory') and original_te.hotel_territory:
			new_te_data["hotel_territory"] = original_te.hotel_territory
		if hasattr(original_te, 'hotel_location') and original_te.hotel_location:
			new_te_data["hotel_location"] = original_te.hotel_location
		if hasattr(original_te, 'hotel_city') and original_te.hotel_city:
			new_te_data["hotel_city"] = original_te.hotel_city
		if hasattr(original_te, 'hotel_country') and original_te.hotel_country:
			new_te_data["hotel_country"] = original_te.hotel_country
		if hasattr(original_te, 'rate_per_day') and original_te.rate_per_day:
			new_te_data["rate_per_day"] = original_te.rate_per_day
		if hasattr(original_te, 'total_nights') and original_te.total_nights:
			new_te_data["total_nights"] = original_te.total_nights
		if hasattr(original_te, 'purpose') and original_te.purpose:
			new_te_data["purpose"] = original_te.purpose
		if hasattr(original_te, 'in_transit') and original_te.in_transit:
			new_te_data["in_transit"] = original_te.in_transit
		
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
		
		# Copy direct_payment_account from original (especially important for refunds)
		direct_payment_account = getattr(original_te, 'direct_payment_account', None)
		if direct_payment_account:
			new_te_data["direct_payment_account"] = direct_payment_account
		
		# Copy is_paid status from original (for refunds, we need to know if original was paid)
		is_paid = getattr(original_te, 'is_paid', 0)
		if is_paid:
			new_te_data["is_paid"] = is_paid
		
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
		
		# Store cash account for refunds (if provided) - use frappe.local to pass to journal entry
		if is_refund and cash_account:
			# Store in frappe.local so journal entry functions can access it
			if not hasattr(frappe.local, 'travel_expense_cash_accounts'):
				frappe.local.travel_expense_cash_accounts = {}
			frappe.local.travel_expense_cash_accounts[new_te.name] = cash_account
		
		# Recalculate totals again after setting amount_company_currency
		new_te.calculate_totals()
		new_te.save(ignore_permissions=True)
		
		# Reload the document to avoid timestamp mismatch
		new_te.reload()
		
		new_te.submit()
		frappe.db.commit()
		
		return {
			"success": True,
			"travel_expense_name": new_te.name,
		}
		
	except Exception as e:
		# Truncate error message if too long for error log (max 140 chars for title)
		error_msg = str(e)
		# Keep error message shorter for log title
		if len(error_msg) > 100:
			error_msg = error_msg[:97] + "..."
		frappe.log_error(f"Error creating additional travel expense: {error_msg}", "Travel Expense Utils Error")
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
		
		# Check if this is a refund
		is_refund = getattr(travel_expense, 'refund', 0)
		
		# Validate all expense rows have expense type and get expense accounts
		expense_accounts = {}
		for expense_row in travel_expense.expenses:
			expense_type = expense_row.expense_type
			if not expense_type:
				frappe.throw(_("Expense Type is required for all expense rows"))
			
			# Get expense account from Expense Claim Type
			expense_account = get_expense_account_from_expense_type(expense_type, company)
			
			# Get amount for this expense (use company currency amount)
			expense_amount = getattr(expense_row, 'amount_company_currency', None) or expense_row.amount or 0
			
			# Group by expense account
			if expense_account in expense_accounts:
				expense_accounts[expense_account] += expense_amount
			else:
				expense_accounts[expense_account] = expense_amount
		
		# Build journal entry accounts list
		je_accounts = []
		
		# For refunds, we need to handle differently
		if is_refund:
			# Get original travel expense to calculate lost amount
			original_expense_name = getattr(travel_expense, 'original_expense', None)
			if not original_expense_name:
				frappe.throw(_("Original Expense is required for refunds"))
			
			original_te = frappe.get_doc("Travel Expense", original_expense_name)
			original_total = getattr(original_te, 'grand_total_company_currency', None) or getattr(original_te, 'total_company_currency', None) or 0
			refund_amount = total_amount
			lost_amount = original_total - refund_amount
			
			if lost_amount < 0:
				frappe.throw(_("Refund amount cannot exceed original expense amount"))
			
			# Get cash in hand account for lost amount
			# First try to get from frappe.local (set during creation)
			cash_in_hand_account = None
			if hasattr(frappe.local, 'travel_expense_cash_accounts'):
				cash_in_hand_account = frappe.local.travel_expense_cash_accounts.get(travel_expense.name)
			
			# Try to get from travel expense custom field (if user selected in modal)
			if not cash_in_hand_account:
				cash_in_hand_account = getattr(travel_expense, 'custom_cash_account', None)
			if not cash_in_hand_account:
				# Try to get from database (in case it was set but not loaded)
				cash_in_hand_account = frappe.db.get_value("Travel Expense", travel_expense.name, "custom_cash_account")
			if not cash_in_hand_account:
				# Fall back to company default
				cash_in_hand_account = frappe.db.get_value("Company", company, "default_cash_account")
			if not cash_in_hand_account:
				# Try to find any cash account
				cash_in_hand_account = frappe.db.get_value("Account", {"company": company, "account_type": "Cash", "is_group": 0}, "name")
			if not cash_in_hand_account:
				# Try to find any bank account
				cash_in_hand_account = frappe.db.get_value("Account", {"company": company, "account_type": "Bank", "is_group": 0}, "name")
			if not cash_in_hand_account:
				frappe.throw(_("Please set Default Cash Account in Company settings for lost amount, or select a Cash/Bank Account in the refund modal"))
			
			# Get expense accounts from original expense (to credit the full original amount)
			# We need to get the expense accounts from the original expense, not from the refund expense
			original_expense_accounts = {}
			if original_te.expenses:
				for expense_row in original_te.expenses:
					expense_type = expense_row.expense_type
					if expense_type:
						# Get expense account from Expense Claim Type
						expense_account = get_expense_account_from_expense_type(expense_type, company)
						# Get amount from original expense (use company currency amount)
						expense_amount = getattr(expense_row, 'amount_company_currency', None) or expense_row.amount or 0
						# Group by expense account
						if expense_account in original_expense_accounts:
							original_expense_accounts[expense_account] += expense_amount
						else:
							original_expense_accounts[expense_account] = expense_amount
			
			# 1. Credit Expense Account(s) - reverse the FULL original expense amount (86.18)
			for expense_account, original_amount in original_expense_accounts.items():
				expense_account_currency = frappe.db.get_value("Account", expense_account, "account_currency") or company_currency
				
				# Calculate base amount
				if expense_account_currency == company_currency:
					expense_base_amount = original_amount
				else:
					try:
						exchange_rate = get_exchange_rate(
							expense_account_currency,
							company_currency,
							posting_date,
							company
						)
						expense_base_amount = original_amount * exchange_rate
					except Exception:
						expense_base_amount = original_amount
				
				# Get cost center and project from first expense row, or from main form
				cost_center = travel_expense.cost_center
				project = travel_expense.project
				if travel_expense.expenses and len(travel_expense.expenses) > 0:
					first_expense_row = travel_expense.expenses[0]
					if first_expense_row.cost_center:
						cost_center = first_expense_row.cost_center
					if first_expense_row.project:
						project = first_expense_row.project
				
				je_accounts.append({
					"account": expense_account,
					"credit_in_account_currency": original_amount,
					"credit": expense_base_amount,
					"cost_center": cost_center,
					"project": project,
					"custom_travel_expense_ref": travel_expense.name,
				})
			
			# 2. For unpaid expenses: Debit Payable Account - refund amount returned (reduces payable)
			# For paid expenses: Debit Bank/Cash Account - refund amount returned
			# Get the payment account from original expense
			original_payment_account = None
			if original_te.is_paid and hasattr(original_te, 'direct_payment_account') and original_te.direct_payment_account:
				original_payment_account = original_te.direct_payment_account
			else:
				# Try to get from company defaults
				original_payment_account = company_doc.default_bank_account or company_doc.default_cash_account
			
			if not original_payment_account:
				original_payment_account = frappe.db.get_value("Account", {"company": company, "account_type": "Bank", "is_group": 0}, "name")
				if not original_payment_account:
					original_payment_account = frappe.db.get_value("Account", {"company": company, "account_type": "Cash", "is_group": 0}, "name")
			
			if original_te.is_paid:
				# Original was paid - refund goes back to bank/cash
				if not original_payment_account:
					frappe.throw(_("Please set Default Bank Account or Default Cash Account in Company settings"))
				
				payment_account_currency = frappe.db.get_value("Account", original_payment_account, "account_currency") or company_currency
				if payment_account_currency == company_currency:
					payment_base_amount = refund_amount
					payment_amount = refund_amount
				else:
					try:
						payment_exchange_rate = get_exchange_rate(
							company_currency,
							payment_account_currency,
							posting_date,
							company
						)
						payment_amount = refund_amount * payment_exchange_rate
						payment_base_amount = refund_amount
					except Exception:
						payment_amount = refund_amount
						payment_base_amount = refund_amount
				
				je_accounts.append({
					"account": original_payment_account,
					"debit_in_account_currency": payment_amount,
					"debit": payment_base_amount,
					"cost_center": travel_expense.cost_center,
					"project": travel_expense.project,
					"custom_travel_expense_ref": travel_expense.name,
				})
			else:
				# Original was unpaid - refund reduces payable
				if payable_account_currency == company_currency:
					payable_base_amount = refund_amount
					payable_amount = refund_amount
				else:
					try:
						payable_exchange_rate = get_exchange_rate(
							company_currency,
							payable_account_currency,
							posting_date,
							company
						)
						payable_amount = refund_amount * payable_exchange_rate
						payable_base_amount = refund_amount
					except Exception:
						payable_amount = refund_amount
						payable_base_amount = refund_amount
				
				je_accounts.append({
					"account": payable_account,
					"debit_in_account_currency": payable_amount,
					"debit": payable_base_amount,
					"party_type": "Member" if traveler else None,
					"party": traveler if traveler else None,
					"cost_center": travel_expense.cost_center,
					"project": travel_expense.project,
					"custom_travel_expense_ref": travel_expense.name,
				})
			
			# 3. Debit Cash in Hand Account - lost amount (if any)
			if lost_amount > 0:
				cash_account_currency = frappe.db.get_value("Account", cash_in_hand_account, "account_currency") or company_currency
				if cash_account_currency == company_currency:
					cash_base_amount = lost_amount
					cash_amount = lost_amount
				else:
					try:
						cash_exchange_rate = get_exchange_rate(
							company_currency,
							cash_account_currency,
							posting_date,
							company
						)
						cash_amount = lost_amount * cash_exchange_rate
						cash_base_amount = lost_amount
					except Exception:
						cash_amount = lost_amount
						cash_base_amount = lost_amount
				
				je_accounts.append({
					"account": cash_in_hand_account,
					"debit_in_account_currency": cash_amount,
					"debit": cash_base_amount,
					"cost_center": travel_expense.cost_center,
					"project": travel_expense.project,
					"custom_travel_expense_ref": travel_expense.name,
				})
		else:
			# Normal expense (not refund) - original logic
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
		# Get first expense account for multi-currency check
		first_expense_account = list(expense_accounts.keys())[0] if expense_accounts else None
		expense_account_currency = frappe.db.get_value("Account", first_expense_account, "account_currency") or company_currency if first_expense_account else company_currency
		is_multi_currency = (
			expense_account_currency != company_currency or 
			payable_account_currency != company_currency
		)
		
		# Create Journal Entry
		remark = f"Travel Expense {travel_expense.name}"
		if is_refund:
			remark += " - Refund"
		else:
			remark += " - Unpaid Expense"
		
		# Add descriptions from expense items on a new line
		descriptions = []
		if travel_expense.expenses:
			for expense_row in travel_expense.expenses:
				description = getattr(expense_row, 'description', None)
				if description and description.strip():
					descriptions.append(description.strip())
		
		if descriptions:
			remark += "\n" + "\n".join(descriptions)
		
		je = frappe.get_doc({
			"doctype": "Journal Entry",
			"voucher_type": "Journal Entry",
			"company": company,
			"posting_date": posting_date,
			"multi_currency": 1 if is_multi_currency else 0,
			"user_remark": remark,
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
		
		# Check if this is a refund
		is_refund = getattr(travel_expense, 'refund', 0)
		
		# Validate all expense rows have expense type and get expense accounts
		expense_accounts = {}
		for expense_row in travel_expense.expenses:
			expense_type = expense_row.expense_type
			if not expense_type:
				frappe.throw(_("Expense Type is required for all expense rows"))
			
			# Get expense account from Expense Claim Type
			expense_account = get_expense_account_from_expense_type(expense_type, company)
			
			# Get amount for this expense (use company currency amount)
			expense_amount = getattr(expense_row, 'amount_company_currency', None) or expense_row.amount or 0
			
			# Group by expense account
			if expense_account in expense_accounts:
				expense_accounts[expense_account] += expense_amount
			else:
				expense_accounts[expense_account] = expense_amount
		
		# Build journal entry accounts list
		je_accounts = []
		
		# For refunds, we need to handle differently
		if is_refund:
			# Get original travel expense to calculate lost amount
			original_expense_name = getattr(travel_expense, 'original_expense', None)
			if not original_expense_name:
				frappe.throw(_("Original Expense is required for refunds"))
			
			original_te = frappe.get_doc("Travel Expense", original_expense_name)
			original_total = getattr(original_te, 'grand_total_company_currency', None) or getattr(original_te, 'total_company_currency', None) or 0
			refund_amount = total_amount
			lost_amount = original_total - refund_amount
			
			if lost_amount < 0:
				frappe.throw(_("Refund amount cannot exceed original expense amount"))
			
			# Get cash in hand account for lost amount
			# First try to get from frappe.local (set during creation)
			cash_in_hand_account = None
			if hasattr(frappe.local, 'travel_expense_cash_accounts'):
				cash_in_hand_account = frappe.local.travel_expense_cash_accounts.get(travel_expense.name)
			
			# Try to get from travel expense custom field (if user selected in modal)
			if not cash_in_hand_account:
				cash_in_hand_account = getattr(travel_expense, 'custom_cash_account', None)
			if not cash_in_hand_account:
				# Try to get from database (in case it was set but not loaded)
				cash_in_hand_account = frappe.db.get_value("Travel Expense", travel_expense.name, "custom_cash_account")
			if not cash_in_hand_account:
				# Fall back to company default
				cash_in_hand_account = frappe.db.get_value("Company", company, "default_cash_account")
			if not cash_in_hand_account:
				# Try to find any cash account
				cash_in_hand_account = frappe.db.get_value("Account", {"company": company, "account_type": "Cash", "is_group": 0}, "name")
			if not cash_in_hand_account:
				# Try to find any bank account
				cash_in_hand_account = frappe.db.get_value("Account", {"company": company, "account_type": "Bank", "is_group": 0}, "name")
			if not cash_in_hand_account:
				frappe.throw(_("Please set Default Cash Account in Company settings for lost amount, or select a Cash/Bank Account in the refund modal"))
			
			# Get expense accounts from original expense (to credit the full original amount)
			# We need to get the expense accounts from the original expense, not from the refund expense
			original_expense_accounts = {}
			if original_te.expenses:
				for expense_row in original_te.expenses:
					expense_type = expense_row.expense_type
					if expense_type:
						# Get expense account from Expense Claim Type
						expense_account = get_expense_account_from_expense_type(expense_type, company)
						# Get amount from original expense (use company currency amount)
						expense_amount = getattr(expense_row, 'amount_company_currency', None) or expense_row.amount or 0
						# Group by expense account
						if expense_account in original_expense_accounts:
							original_expense_accounts[expense_account] += expense_amount
						else:
							original_expense_accounts[expense_account] = expense_amount
			
			# 1. Credit Expense Account(s) - reverse the FULL original expense amount (86.18)
			for expense_account, original_amount in original_expense_accounts.items():
				expense_account_currency = frappe.db.get_value("Account", expense_account, "account_currency") or company_currency
				
				# Calculate base amount
				if expense_account_currency == company_currency:
					expense_base_amount = original_amount
				else:
					try:
						exchange_rate = get_exchange_rate(
							expense_account_currency,
							company_currency,
							posting_date,
							company
						)
						expense_base_amount = original_amount * exchange_rate
					except Exception:
						expense_base_amount = original_amount
				
				# Get cost center and project from first expense row, or from main form
				cost_center = travel_expense.cost_center
				project = travel_expense.project
				if travel_expense.expenses and len(travel_expense.expenses) > 0:
					first_expense_row = travel_expense.expenses[0]
					if first_expense_row.cost_center:
						cost_center = first_expense_row.cost_center
					if first_expense_row.project:
						project = first_expense_row.project
				
				je_accounts.append({
					"account": expense_account,
					"credit_in_account_currency": original_amount,
					"credit": expense_base_amount,
					"cost_center": cost_center,
					"project": project,
					"custom_travel_expense_ref": travel_expense.name,
				})
			
			# 2. Debit Direct Payment Account - refund amount returned
			if direct_payment_account_currency == company_currency:
				payment_base_amount = refund_amount
				payment_amount = refund_amount
			else:
				try:
					payment_exchange_rate = get_exchange_rate(
						company_currency,
						direct_payment_account_currency,
						posting_date,
						company
					)
					payment_amount = refund_amount * payment_exchange_rate
					payment_base_amount = refund_amount
				except Exception:
					payment_amount = refund_amount
					payment_base_amount = refund_amount
			
			je_accounts.append({
				"account": direct_payment_account,
				"debit_in_account_currency": payment_amount,
				"debit": payment_base_amount,
				"cost_center": travel_expense.cost_center,
				"project": travel_expense.project,
				"custom_travel_expense_ref": travel_expense.name,
			})
			
			# 3. Debit Cash in Hand Account - lost amount (if any)
			if lost_amount > 0:
				cash_account_currency = frappe.db.get_value("Account", cash_in_hand_account, "account_currency") or company_currency
				if cash_account_currency == company_currency:
					cash_base_amount = lost_amount
					cash_amount = lost_amount
				else:
					try:
						cash_exchange_rate = get_exchange_rate(
							company_currency,
							cash_account_currency,
							posting_date,
							company
						)
						cash_amount = lost_amount * cash_exchange_rate
						cash_base_amount = lost_amount
					except Exception:
						cash_amount = lost_amount
						cash_base_amount = lost_amount
				
				je_accounts.append({
					"account": cash_in_hand_account,
					"debit_in_account_currency": cash_amount,
					"debit": cash_base_amount,
					"cost_center": travel_expense.cost_center,
					"project": travel_expense.project,
					"custom_travel_expense_ref": travel_expense.name,
				})
		else:
			# Normal expense (not refund) - original logic
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
		# Get first expense account for multi-currency check
		first_expense_account = list(expense_accounts.keys())[0] if expense_accounts else None
		expense_account_currency = frappe.db.get_value("Account", first_expense_account, "account_currency") or company_currency if first_expense_account else company_currency
		is_multi_currency = (
			expense_account_currency != company_currency or 
			direct_payment_account_currency != company_currency
		)
		
		# Create Journal Entry
		remark = f"Travel Expense {travel_expense.name}"
		if is_refund:
			remark += " - Refund"
		else:
			remark += " - Paid Expense"
		
		# Add descriptions from expense items on a new line
		descriptions = []
		if travel_expense.expenses:
			for expense_row in travel_expense.expenses:
				description = getattr(expense_row, 'description', None)
				if description and description.strip():
					descriptions.append(description.strip())
		
		if descriptions:
			remark += "\n" + "\n".join(descriptions)
		
		je = frappe.get_doc({
			"doctype": "Journal Entry",
			"voucher_type": "Journal Entry",
			"company": company,
			"posting_date": posting_date,
			"multi_currency": 1 if is_multi_currency else 0,
			"user_remark": remark,
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


@frappe.whitelist()
def cancel_travel_expense_charges(travel_expense_name):
	"""
	Cancel charges for a travel expense by creating a reverse journal entry
	and marking the travel expense as cancelled.
	
	Args:
		travel_expense_name: Name of the Travel Expense document
	
	Returns:
		dict: Success status and journal entry name
	"""
	try:
		# Get the travel expense document
		travel_expense = frappe.get_doc("Travel Expense", travel_expense_name)
		
		# Check if already cancelled
		if travel_expense.is_cancelled:
			return {
				"success": False,
				"error": "Travel expense is already cancelled."
			}
		
		# Find the original journal entry linked to this travel expense
		original_je = frappe.db.sql("""
			SELECT name, docstatus
			FROM `tabJournal Entry`
			WHERE EXISTS (
				SELECT 1 FROM `tabJournal Entry Account`
				WHERE parent = `tabJournal Entry`.name
				AND custom_travel_expense_ref = %s
			)
			AND docstatus = 1
			ORDER BY creation DESC
			LIMIT 1
		""", (travel_expense_name,), as_dict=True)
		
		if not original_je:
			return {
				"success": False,
				"error": "No submitted journal entry found for this travel expense."
			}
		
		original_je_name = original_je[0].name
		original_je_doc = frappe.get_doc("Journal Entry", original_je_name)
		
		# Create reverse journal entry (swap debits and credits)
		reverse_accounts = []
		for account in original_je_doc.accounts:
			# Swap debit and credit
			# If original had debit, reverse should have credit (and vice versa)
			original_debit = account.debit or 0
			original_credit = account.credit or 0
			original_debit_in_account_currency = account.debit_in_account_currency or original_debit
			original_credit_in_account_currency = account.credit_in_account_currency or original_credit
			
			reverse_account = {
				"account": account.account,
				"debit": original_credit,
				"debit_in_account_currency": original_credit_in_account_currency,
				"credit": original_debit,
				"credit_in_account_currency": original_debit_in_account_currency,
				"party_type": account.party_type,
				"party": account.party,
				"cost_center": account.cost_center,
				"project": account.project,
				"custom_travel_expense_ref": travel_expense_name,
			}
			reverse_accounts.append(reverse_account)
		
		# Create reverse journal entry
		reverse_je = frappe.get_doc({
			"doctype": "Journal Entry",
			"voucher_type": "Journal Entry",
			"company": original_je_doc.company,
			"posting_date": frappe.utils.today(),
			"multi_currency": original_je_doc.multi_currency,
			"user_remark": f"Reverse entry for cancelled Travel Expense {travel_expense_name}",
			"accounts": reverse_accounts
		})
		
		# Copy currency and exchange rate if multi-currency
		if original_je_doc.multi_currency:
			reverse_je.currency = original_je_doc.currency
			reverse_je.exchange_rate = original_je_doc.exchange_rate
		
		# Copy accounting dimensions
		if hasattr(original_je_doc, 'company_group') and original_je_doc.company_group:
			reverse_je.company_group = original_je_doc.company_group
		if hasattr(original_je_doc, 'branch') and original_je_doc.branch:
			reverse_je.branch = original_je_doc.branch
		
		# Insert and submit the reverse journal entry
		reverse_je.insert(ignore_permissions=True)
		reverse_je.submit()
		frappe.db.commit()
		
		# Update travel expense to mark as cancelled
		frappe.db.set_value("Travel Expense", travel_expense_name, "is_cancelled", 1)
		frappe.db.commit()
		
		return {
			"success": True,
			"journal_entry_name": reverse_je.name
		}
		
	except Exception as e:
		frappe.log_error(f"Error cancelling travel expense charges: {str(e)}", "Travel Expense Utils Error")
		return {
			"success": False,
			"error": str(e)
		}

