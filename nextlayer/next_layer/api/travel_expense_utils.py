# Copyright (c) 2025, Next Layer and contributors
# For license information, please see license.txt

import frappe
from frappe import _


@frappe.whitelist()
def create_additional_travel_expense(original_travel_expense, expense_items, company=None, traveler_name=None, create_journal_entry=False):
	"""
	Create a new Travel Expense as an additional expense linked to the original
	
	Args:
		original_travel_expense: Name of the original Travel Expense
		expense_items: List of travel expense detail items
		company: Company (optional, will use from original if not provided)
		traveler_name: Traveler Name (optional, will use from original if not provided)
		create_journal_entry: Boolean to create journal entry and book as paid
	
	Returns:
		dict: Success status and travel expense name
	"""
	try:
		# Parse expense_items if it's a JSON string
		if isinstance(expense_items, str):
			import json
			expense_items = json.loads(expense_items)
		
		# Convert create_journal_entry to boolean
		if isinstance(create_journal_entry, str):
			create_journal_entry = create_journal_entry.lower() in ('true', '1', 'yes')
		create_journal_entry = bool(create_journal_entry)
		
		# Get original travel expense
		original_te = frappe.get_doc("Travel Expense", original_travel_expense)
		
		# Create new travel expense - copy all relevant fields from original
		new_te_data = {
			"doctype": "Travel Expense",
			"traveler_name": traveler_name or original_te.traveler_name,
			"company": company or original_te.company,
			"is_addition": 1,
			"travel_group": original_te.travel_group,
			"posting_date": frappe.utils.today(),
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
			
			expense_detail = {
				"expense_type": safe_get(item, "expense_type"),
				"expense_date": safe_get(item, "expense_date") or frappe.utils.today(),
				"amount": safe_get(item, "amount", 0),
				"sanctioned_amount": safe_get(item, "sanctioned_amount") or safe_get(item, "amount", 0),
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
		
		# Recalculate totals and convert amounts to company currency before submitting
		# This ensures grand_total and grand_total_company_currency are set correctly
		new_te.calculate_totals()
		
		# Convert all expense amounts to company currency if needed
		if new_te.expenses:
			company_currency = frappe.get_cached_value("Company", new_te.company, "default_currency")
			transaction_currency = getattr(new_te, 'currency', None) or company_currency
			
			if transaction_currency != company_currency:
				for expense in new_te.expenses:
					if expense.amount and not expense.amount_company_currency:
						try:
							transaction_date = expense.expense_date or new_te.posting_date or frappe.utils.today()
							exchange_rate = frappe.utils.get_exchange_rate(
								transaction_currency,
								company_currency,
								transaction_date,
								new_te.company
							)
							expense.amount_company_currency = expense.amount * exchange_rate
						except Exception:
							# If conversion fails, use same amount
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
		
		# Create journal entry if requested
		journal_entry_name = None
		journal_entry_names = None
		if create_journal_entry:
			try:
				# Reload the document to ensure we have the latest totals
				new_te.reload()
				journal_entry_result = create_journal_entry_for_travel_expense(new_te)
				# Handle None (when is_paid is ticked - ERPNext handles it), string, or list
				if journal_entry_result is None:
					# is_paid is ticked, ERPNext handles GL entries automatically
					journal_entry_name = None
					journal_entry_names = None
				elif isinstance(journal_entry_result, list):
					journal_entry_names = journal_entry_result
					journal_entry_name = ", ".join(journal_entry_result)  # For backward compatibility
				else:
					journal_entry_name = journal_entry_result
			except Exception as e:
				frappe.log_error(f"Error creating journal entry for travel expense {new_te.name}: {str(e)}", "Travel Expense Utils Error")
				# Don't fail the whole operation if journal entry creation fails
				pass
		
		return {
			"success": True,
			"travel_expense_name": new_te.name,
			"journal_entry_name": journal_entry_name,
			"journal_entry_names": journal_entry_names,  # List of journal entries if multiple
		}
		
	except Exception as e:
		frappe.log_error(f"Error creating additional travel expense: {str(e)}", "Travel Expense Utils Error")
		return {
			"success": False,
			"error": str(e),
		}


def create_journal_entry_for_travel_expense(travel_expense):
	"""
	Create a Journal Entry to book the travel expense
	
	When is_paid is ticked:
	- ERPNext automatically creates GL entries, so we don't create a journal entry
	
	When is_paid is not ticked:
	- Creates journal entry that debits payable and credits payment account
	
	Args:
		travel_expense: Travel Expense document
	
	Returns:
		str: Journal Entry name, or None if is_paid is ticked
	"""
	try:
		# Check if is_paid is ticked
		is_paid = getattr(travel_expense, 'is_paid', 0)
		
		# If is_paid is ticked, ERPNext handles GL entries automatically
		# So we don't need to create a journal entry
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
		
		# Determine which amount to use based on payable account currency
		# Use grand_total (bottom totals) instead of travel_amount
		if payable_account_currency == company_currency:
			# Use company currency amount from totals
			total_amount = getattr(travel_expense, 'grand_total_company_currency', None) or getattr(travel_expense, 'total_company_currency', None) or 0
			je_currency = company_currency
		else:
			# Use transaction currency amount from totals
			total_amount = getattr(travel_expense, 'grand_total', None) or getattr(travel_expense, 'total', None) or 0
			je_currency = transaction_currency
		
		if total_amount <= 0:
			frappe.throw(_("Cannot create journal entry: Travel expense grand total is zero or negative. Please ensure expenses are added and amounts are set."))
		
		# Get payment account (bank/cash) - use company default
		payment_account = company_doc.default_bank_account or company_doc.default_cash_account
		if not payment_account:
			# Try to get from account defaults
			payment_account = frappe.db.get_value("Account", {"company": company, "account_type": "Bank", "is_group": 0}, "name")
			if not payment_account:
				payment_account = frappe.db.get_value("Account", {"company": company, "account_type": "Cash", "is_group": 0}, "name")
		
		if not payment_account:
			frappe.throw(_("Please set Default Bank Account or Default Cash Account in Company settings"))
		
		# Get payment account currency
		payment_account_currency = frappe.db.get_value("Account", payment_account, "account_currency") or company_currency
		
		# Get posting date safely
		posting_date = getattr(travel_expense, 'posting_date', None) or frappe.utils.today()
		
		# Get traveler (Member) for party
		traveler = getattr(travel_expense, 'traveler_name', None)
		
		# Calculate base amount (in company currency) for payable account
		if payable_account_currency == company_currency:
			payable_base_amount = total_amount
			payable_exchange_rate = 1
		else:
			# Convert payable account currency to company currency
			try:
				payable_exchange_rate = frappe.utils.get_exchange_rate(
					payable_account_currency,
					company_currency,
					posting_date,
					company
				)
				payable_base_amount = total_amount * payable_exchange_rate
			except Exception:
				# If exchange rate not found, use same amount
				payable_base_amount = total_amount
				payable_exchange_rate = 1
		
		# Calculate payment account amount and base amount
		# Payment account should credit the same value, but in its own currency
		if payment_account_currency == payable_account_currency:
			# Same currency, use same amount
			payment_amount = total_amount
			payment_base_amount = payable_base_amount
		elif payment_account_currency == company_currency:
			# Payment account is in company currency, use base amount
			payment_amount = payable_base_amount
			payment_base_amount = payable_base_amount
		else:
			# Payment account is in different currency, convert from payable account currency
			try:
				payment_exchange_rate = frappe.utils.get_exchange_rate(
					payable_account_currency,
					payment_account_currency,
					posting_date,
					company
				)
				payment_amount = total_amount * payment_exchange_rate
				# Convert to base
				payment_to_base_rate = frappe.utils.get_exchange_rate(
					payment_account_currency,
					company_currency,
					posting_date,
					company
				)
				payment_base_amount = payment_amount * payment_to_base_rate
			except Exception:
				# If conversion fails, use same amounts
				payment_amount = total_amount
				payment_base_amount = payable_base_amount
		
		# Determine if multi-currency journal entry
		is_multi_currency = (payable_account_currency != company_currency) or (payment_account_currency != company_currency)
		
		# Create Journal Entry: Debit Payable, Credit Payment Account
		je = frappe.get_doc({
			"doctype": "Journal Entry",
			"voucher_type": "Journal Entry",
			"company": company,
			"posting_date": posting_date,
			"multi_currency": 1 if is_multi_currency else 0,
			"user_remark": f"Payment for Travel Expense {travel_expense.name}",
			"accounts": [
				{
					"account": payable_account,
					"debit_in_account_currency": total_amount,
					"debit": payable_base_amount,
					"party_type": "Member" if traveler else None,
					"party": traveler if traveler else None,
					# No reference_type/reference_name - Travel Expense is not a valid reference type
				},
				{
					"account": payment_account,
					"credit_in_account_currency": payment_amount,
					"credit": payment_base_amount,
				}
			]
		})
		
		# Set currency for journal entry if multi-currency (use payable account currency as primary)
		if is_multi_currency:
			je.currency = payable_account_currency
			je.exchange_rate = payable_exchange_rate
		
		# Add accounting dimensions if present
		if hasattr(travel_expense, 'company_group') and travel_expense.company_group:
			je.company_group = travel_expense.company_group
		if hasattr(travel_expense, 'branch') and travel_expense.branch:
			je.branch = travel_expense.branch
		if hasattr(travel_expense, 'cost_center') and travel_expense.cost_center:
			# Apply cost center to both accounts
			for account in je.accounts:
				account.cost_center = travel_expense.cost_center
		if hasattr(travel_expense, 'project') and travel_expense.project:
			# Apply project to both accounts
			for account in je.accounts:
				account.project = travel_expense.project
		
		# Insert and submit the journal entry
		je.insert(ignore_permissions=True)
		je.submit()
		frappe.db.commit()
		
		return je.name
		
	except Exception as e:
		frappe.log_error(f"Error creating journal entry: {str(e)}", "Travel Expense Utils Error")
		raise

