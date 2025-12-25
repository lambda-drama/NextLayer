# Copyright (c) 2025, Next Layer and contributors
# For license information, please see license.txt

import frappe
from frappe import _


@frappe.whitelist()
def create_additional_expense_claim(original_expense_claim, expense_items, company=None, employee=None, expense_approver=None, create_journal_entry=False):
	"""
	Create a new Expense Claim as an additional expense linked to the original
	
	Args:
		original_expense_claim: Name of the original Expense Claim
		expense_items: List of expense claim detail items
		company: Company (optional, will use from original if not provided)
		employee: Employee (optional, will use from original if not provided)
		expense_approver: Expense Approver (optional, will use from original if not provided)
		create_journal_entry: Boolean to create journal entry and book as paid
	
	Returns:
		dict: Success status and expense claim name
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
		
		# Get original expense claim
		original_ec = frappe.get_doc("Expense Claim", original_expense_claim)
		
		# Create new expense claim - copy all relevant fields from original
		new_ec_data = {
			"doctype": "Expense Claim",
			"employee": employee or original_ec.employee,
			"company": company or original_ec.company,
			"expense_approver": expense_approver or original_ec.expense_approver,
			"custom_original_expense_claim": original_expense_claim,
			"custom_is_addition": 1,
			"custom_traveller_name": original_ec.custom_traveller_name,
			"department": original_ec.department,
			"custom_travel_group": original_ec.custom_travel_group,
			"approval_status":original_ec.approval_status,
		
		}
		
		# Copy mandatory accounting dimension fields from original
		# Use getattr to safely get field values even if they don't exist
		company_group = getattr(original_ec, 'company_group', None)
		if company_group:
			new_ec_data["company_group"] = company_group
		
		branch = getattr(original_ec, 'branch', None)
		if branch:
			new_ec_data["branch"] = branch
		
		marka = getattr(original_ec, 'marka', None)
		if marka:
			new_ec_data["marka"] = marka
		
		# Copy other common fields that might be needed
		payable_account = getattr(original_ec, 'payable_account', None)
		if payable_account:
			new_ec_data["payable_account"] = payable_account
		
		cost_center = getattr(original_ec, 'cost_center', None)
		if cost_center:
			new_ec_data["cost_center"] = cost_center
		
		project = getattr(original_ec, 'project', None)
		if project:
			new_ec_data["project"] = project
		
		# Create new expense claim
		new_ec = frappe.get_doc(new_ec_data)
		
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
			# print("Yanguze item:", item)
			# frappe.log_error(f"Processing expense item: {item}", "Expense Claim Utils Info")

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
				"company": safe_get(item, "company") or new_ec.company,
				"receipt": safe_get(item, "receipt"),
				"description": safe_get(item, "description"),
				# PRN Number - ensure it's included even if empty string
				"custom_pnr_number": safe_get(item, "custom_prn_number") or "",
				# Hotel fields
				"hotel_checkin_date": safe_get(item, "hotel_checkin_date"),
				"hotel_checkout_date": safe_get(item, "hotel_checkout_date"),
				"purpose": safe_get(item, "purpose"),
				"hotel_territory": safe_get(item, "hotel_territory"),
				"hotel_location": safe_get(item, "hotel_location"),
				"custom_hotel_name": safe_get(item, "custom_hotel_name"),
				"total_nights": safe_get(item, "total_nights"),
				"custom_hotel": safe_get(item, "custom_hotel"),
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
    
				"cost_center":original_ec.cost_center,
			}
			
			# Remove None values (but keep empty strings and 0)
			expense_detail = {k: v for k, v in expense_detail.items() if v is not None}
			
			
			# Append the expense detail
			new_ec.append("expenses", expense_detail)
			
			# Explicitly set custom_prn_number on the last appended row
			# This ensures it's saved even if the field wasn't recognized during append
			
		# Insert and save
		new_ec.insert(ignore_permissions=True)
		new_ec.submit()
		frappe.db.commit()
		
		# Create journal entry if requested
		journal_entry_name = None
		if create_journal_entry:
			try:
				journal_entry_name = create_journal_entry_for_expense_claim(new_ec)
			except Exception as e:
				frappe.log_error(f"Error creating journal entry for expense claim {new_ec.name}: {str(e)}", "Expense Claim Utils Error")
				# Don't fail the whole operation if journal entry creation fails
				pass
		
		return {
			"success": True,
			"expense_claim_name": new_ec.name,
			"journal_entry_name": journal_entry_name,
		}
		
	except Exception as e:
		frappe.log_error(f"Error creating additional expense claim: {str(e)}", "Expense Claim Utils Error")
		return {
			"success": False,
			"error": str(e),
		}


def create_journal_entry_for_expense_claim(expense_claim):
	"""
	Create a Journal Entry to book the expense claim as paid
	
	Args:
		expense_claim: Expense Claim document
	
	Returns:
		str: Journal Entry name
	"""
	try:
		# Get total amount from expense claim
		total_amount = expense_claim.total_sanctioned_amount or expense_claim.total_claimed_amount or 0
		
		if total_amount <= 0:
			frappe.throw(_("Cannot create journal entry: Expense claim amount is zero or negative"))
		
		# Get company details
		company = expense_claim.company
		company_doc = frappe.get_doc("Company", company)
		
		# Get default accounts from company
		# For expense claim payment, we typically:
		# - Debit: Expense Claim Payable Account (or default payable account)
		# - Credit: Bank/Cash Account (or default payment account)
		
		# Get payable account from expense claim or company default
		payable_account = expense_claim.payable_account or company_doc.default_expense_claim_payable_account
		if not payable_account:
			# Try to get from company defaults
			payable_account = frappe.db.get_value("Company", company, "default_payable_account")
		
		if not payable_account:
			frappe.throw(_("Please set Payable Account in Expense Claim or Company settings"))
		
		# Get payment account (bank/cash) - use company default
		payment_account = company_doc.default_bank_account or company_doc.default_cash_account
		if not payment_account:
			# Try to get from account defaults
			payment_account = frappe.db.get_value("Account", {"company": company, "account_type": "Bank", "is_group": 0}, "name")
			if not payment_account:
				payment_account = frappe.db.get_value("Account", {"company": company, "account_type": "Cash", "is_group": 0}, "name")
		
		if not payment_account:
			frappe.throw(_("Please set Default Bank Account or Default Cash Account in Company settings"))
		
		# Create Journal Entry
		je = frappe.get_doc({
			"doctype": "Journal Entry",
			"voucher_type": "Journal Entry",
			"company": company,
			"posting_date": frappe.utils.today(),
			"user_remark": f"Payment for Expense Claim {expense_claim.name}",
			"accounts": [
				{
					"account": payable_account,
					"debit_in_account_currency": total_amount,
					"party_type": "Employee",
					"party": expense_claim.employee,
					"reference_type": "Expense Claim",
					"reference_name": expense_claim.name,
				},
				{
					"account": payment_account,
					"credit_in_account_currency": total_amount,
					"reference_type": "Expense Claim",
					"reference_name": expense_claim.name,
				}
			]
		})
		
		# Add accounting dimensions if present
		if hasattr(expense_claim, 'company_group') and expense_claim.company_group:
			je.company_group = expense_claim.company_group
		if hasattr(expense_claim, 'branch') and expense_claim.branch:
			je.branch = expense_claim.branch
		if hasattr(expense_claim, 'cost_center') and expense_claim.cost_center:
			# Apply cost center to both accounts
			for account in je.accounts:
				account.cost_center = expense_claim.cost_center
		if hasattr(expense_claim, 'project') and expense_claim.project:
			# Apply project to both accounts
			for account in je.accounts:
				account.project = expense_claim.project
		
		# Insert and submit the journal entry
		je.insert(ignore_permissions=True)
		je.submit()
		frappe.db.commit()
		
		return je.name
		
	except Exception as e:
		frappe.log_error(f"Error creating journal entry: {str(e)}", "Expense Claim Utils Error")
		raise


def create_journal_entry_on_submit(doc, method):
	"""
	Hook function called when Expense Claim is submitted.
	Creates a journal entry if custom_book_journal is checked.
	
	Args:
		doc: Expense Claim document
		method: Method name (on_submit)
	"""
	try:
		# Check if custom_book_journal is checked
		if hasattr(doc, 'custom_book_journal') and doc.custom_book_journal:
			# Create journal entry
			journal_entry_name = create_journal_entry_for_expense_claim(doc)
			frappe.msgprint(
				_("Journal Entry {0} has been created and submitted for this expense claim.").format(
					frappe.bold(journal_entry_name)
				),
				indicator="green",
				alert=True
			)
	except Exception as e:
		# Log error but don't prevent submission
		frappe.log_error(
			f"Error creating journal entry on Expense Claim submit for {doc.name}: {str(e)}",
			"Expense Claim Utils Error"
		)
		# Show warning to user but don't fail submission
		frappe.msgprint(
			_("Expense Claim submitted successfully, but there was an error creating the journal entry. Please check Error Log."),
			indicator="orange",
			alert=True
		)




