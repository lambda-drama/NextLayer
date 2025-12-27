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
				"hotel_city": safe_get(item, "hotel_city"),
				"hotel_country": safe_get(item, "hotel_country"),
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
		
		# Insert and save
		new_ec.insert(ignore_permissions=True)
		new_ec.submit()
		frappe.db.commit()
		
		# Create journal entry if requested
		journal_entry_name = None
		journal_entry_names = None
		if create_journal_entry:
			try:
				journal_entry_result = create_journal_entry_for_expense_claim(new_ec)
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
				frappe.log_error(f"Error creating journal entry for expense claim {new_ec.name}: {str(e)}", "Expense Claim Utils Error")
				# Don't fail the whole operation if journal entry creation fails
				pass
		
		return {
			"success": True,
			"expense_claim_name": new_ec.name,
			"journal_entry_name": journal_entry_name,
			"journal_entry_names": journal_entry_names,  # List of journal entries if multiple
		}
		
	except Exception as e:
		frappe.log_error(f"Error creating additional expense claim: {str(e)}", "Expense Claim Utils Error")
		return {
			"success": False,
			"error": str(e),
		}


def create_journal_entry_for_expense_claim(expense_claim):
	"""
	Create a Journal Entry to book the expense claim
	
	When is_paid is ticked:
	- ERPNext automatically creates GL entries, so we don't create a journal entry
	
	When is_paid is not ticked:
	- Creates journal entry that debits payable and credits payment account
	
	Args:
		expense_claim: Expense Claim document
	
	Returns:
		str: Journal Entry name, or None if is_paid is ticked
	"""
	try:
		# Check if is_paid is ticked
		is_paid = getattr(expense_claim, 'is_paid', 0)
		
		# If is_paid is ticked, ERPNext handles GL entries automatically
		# So we don't need to create a journal entry
		if is_paid:
			return None
		
		# Get total amount from expense claim
		total_amount = expense_claim.total_sanctioned_amount or expense_claim.total_claimed_amount or 0
		
		if total_amount <= 0:
			frappe.throw(_("Cannot create journal entry: Expense claim amount is zero or negative"))
		
		# Get company details
		company = expense_claim.company
		company_doc = frappe.get_doc("Company", company)
		
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
		
		# Get posting date safely
		posting_date = getattr(expense_claim, 'expense_claim_date', None) or \
		              getattr(expense_claim, 'posting_date', None) or \
		              frappe.utils.today()
		
		# Create Journal Entry: Debit Payable, Credit Payment Account
		# Only reference Expense Claim on the debit row (payable account), not on credit row
		je = frappe.get_doc({
			"doctype": "Journal Entry",
			"voucher_type": "Journal Entry",
			"company": company,
			"posting_date": posting_date,
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
					# No reference_type/reference_name on credit row
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


def update_child_table_details(doc, method):
	"""
	Hook function called before Expense Claim is saved.
	Updates child table details based on main doctype fields.
	
	Args:
		doc: Expense Claim document
		method: Method name (before_save)
	"""
	try:
		# Count travel expenses
		travel_count = 0
		if doc.expenses:
			for row in doc.expenses:
				if row.expense_type and "travel" in row.expense_type.lower():
					travel_count += 1
		
		# If no travel expenses and custom_amount exists, create a travel row
		if travel_count == 0 and hasattr(doc, 'custom_amount') and doc.custom_amount:
			# Convert currency if custom_currency (transaction currency) is different from company currency
			# custom_amount is in custom_currency (transaction currency)
			custom_amount = doc.custom_amount
			converted_amount = custom_amount
			
			# Get company default currency
			company_currency = None
			if doc.company:
				company_currency = frappe.get_cached_value("Company", doc.company, "default_currency")
			
			# Convert if currencies are different
			if (hasattr(doc, 'custom_currency') and doc.custom_currency and 
			    company_currency and doc.custom_currency != company_currency):
				try:
					transaction_date = doc.expense_claim_date or frappe.utils.today()
					exchange_rate = frappe.utils.get_exchange_rate(
						doc.custom_currency,
						company_currency,
						transaction_date,
						doc.company
					)
					converted_amount = float(custom_amount) * exchange_rate
				except Exception as e:
					frappe.log_error(
						f"Error converting currency for Expense Claim {doc.name}: {str(e)}",
						"Expense Claim Utils Warning"
					)
					# Use original amount if conversion fails
					converted_amount = float(custom_amount) if custom_amount else 0
			else:
				# Same currency or no currency specified, use amount directly
				try:
					converted_amount = float(custom_amount) if custom_amount else 0
				except (ValueError, TypeError):
					converted_amount = 0
			
			# Create a new travel expense row
			row = doc.append("expenses", {})
			row.expense_type = "Travel"
			# Use custom_amountcompany_currency if available (already converted), otherwise use converted_amount
			amount_to_use = doc.custom_amountcompany_currency if hasattr(doc, 'custom_amountcompany_currency') and doc.custom_amountcompany_currency else converted_amount
			row.amount = amount_to_use
			row.sanctioned_amount = amount_to_use
			if hasattr(doc, 'expense_claim_date') and doc.expense_claim_date:
				row.expense_date = doc.expense_claim_date
			else:
				row.expense_date = frappe.utils.today()
		
		# Transfer travel details from main doctype to child table if expense type is Travel
		if doc.expenses:
			for row in doc.expenses:
				# Check if expense type is Travel (case-insensitive)
				if row.expense_type and "travel" in row.expense_type.lower():
					# Field mapping: main doctype -> child table
					field_mappings = [
						("custom_departure_airport", "custom_departure_airport"),
						("custom_arrival_airport", "custom_arrival_airport"),
						("custom_airlines", "custom_airlines"),
						("custom_date_of_travel", "custom_date_of_travel"),
						("custom_date_of_arrival", "custom_date_of_arrival"),
						("custom_date_of_purchase", "custom_date_of_purchase"),
						("custom_booked_by", "custom_booked_by"),
						("custom_travel_type", "custom_travel_type"),
						("custom_pnr_number_", "custom_prn_number"),  # Note: different field names
					]
					
					# Transfer values if child table field is missing/empty and main doctype has value
					for main_field, child_field in field_mappings:
						if hasattr(doc, main_field):
							main_value = doc.get(main_field)
							child_value = row.get(child_field)
							
							# If child field is missing/empty and main has value, transfer it
							if main_value and (not child_value or child_value == "" or child_value is None):
								row.set(child_field, main_value)
					
					# Special handling for custom_amount -> amount: use custom_amountcompany_currency if available
					if hasattr(doc, 'custom_amount') and doc.custom_amount is not None:
						# Use custom_amountcompany_currency if it exists (already converted), otherwise convert
						if hasattr(doc, 'custom_amountcompany_currency') and doc.custom_amountcompany_currency:
							# Use the already converted amount
							row.amount = doc.custom_amountcompany_currency
							row.sanctioned_amount = doc.custom_amountcompany_currency
						else:
							# Convert if needed
							custom_amount = doc.custom_amount
							converted_amount = custom_amount
							
							# Get company default currency
							company_currency = None
							if doc.company:
								company_currency = frappe.get_cached_value("Company", doc.company, "default_currency")
							
							# Convert if currencies are different
							# custom_amount is in custom_currency (transaction currency), convert to company currency
							if (hasattr(doc, 'custom_currency') and doc.custom_currency and 
							    company_currency and doc.custom_currency != company_currency):
								try:
									transaction_date = doc.expense_claim_date or frappe.utils.today()
									exchange_rate = frappe.utils.get_exchange_rate(
										doc.custom_currency,
										company_currency,
										transaction_date,
										doc.company
									)
									converted_amount = float(custom_amount) * exchange_rate
								except Exception as e:
									frappe.log_error(
										f"Error converting currency for Expense Claim {doc.name}: {str(e)}",
										"Expense Claim Utils Warning"
									)
									# Use original amount if conversion fails
									try:
										converted_amount = float(custom_amount) if custom_amount else 0
									except (ValueError, TypeError):
										converted_amount = 0
							else:
								# Same currency or no currency specified
								try:
									converted_amount = float(custom_amount) if custom_amount else 0
								except (ValueError, TypeError):
									converted_amount = 0
							
							# Update row with converted amount
							row.amount = converted_amount
							row.sanctioned_amount = converted_amount
	except Exception as e:
		# Log error but don't prevent save
		frappe.log_error(
			f"Error updating child table details for Expense Claim {doc.name}: {str(e)}",
			"Expense Claim Utils Error"
		)
		# Don't throw - let save proceed


def set_expense_approver_and_status(doc, method):
	"""
	Hook function called before Expense Claim is submitted.
	Sets expense_approver to Administrator if null, and updates approval_status if needed.
	
	Args:
		doc: Expense Claim document
		method: Method name (before_submit)
	"""
	try:
		# Set expense_approver to Administrator if it's null or empty
		if not doc.expense_approver:
			doc.expense_approver = "Administrator"
			frappe.msgprint(
				_("Expense Approver has been set to Administrator."),
				indicator="blue",
				alert=True
			)
		
		# If approval_status is Draft and custom_traveller_name is filled, change to Approved
		if hasattr(doc, 'approval_status') and doc.approval_status == "Draft":
			if hasattr(doc, 'custom_traveller_name') and doc.custom_traveller_name:
				doc.approval_status = "Approved"
				frappe.msgprint(
					_("Approval Status has been changed from Draft to Approved."),
					indicator="green",
					alert=True
				)
	except Exception as e:
		# Log error but don't prevent submission
		frappe.log_error(
			f"Error setting expense approver/status for Expense Claim {doc.name}: {str(e)}",
			"Expense Claim Utils Error"
		)
		# Don't throw - let submission proceed


def create_journal_entry_on_submit(doc, method):
	"""
	Hook function called when Expense Claim is submitted.
	Creates a journal entry if custom_book_journal is checked.
	
	Note: If is_paid is ticked, ERPNext automatically creates GL entries,
	so we don't create a journal entry in that case.
	
	Args:
		doc: Expense Claim document
		method: Method name (on_submit)
	"""
	try:
		# Check if custom_book_journal is checked
		if hasattr(doc, 'custom_book_journal') and doc.custom_book_journal:
			# Check if is_paid is ticked - if so, ERPNext handles it automatically
			is_paid = getattr(doc, 'is_paid', 0)
			if is_paid:
				frappe.msgprint(
					_("Expense Claim is marked as paid. ERPNext will automatically create GL entries."),
					indicator="blue",
					alert=True
				)
				return
			
			# Create journal entry (only when is_paid is not ticked)
			journal_entry_result = create_journal_entry_for_expense_claim(doc)
			
			# Handle None (shouldn't happen here since we checked is_paid), string, or list
			if journal_entry_result is None:
				# This shouldn't happen since we checked is_paid above, but handle it gracefully
				return
			elif isinstance(journal_entry_result, list):
				journal_entry_names = journal_entry_result
				message = _("Journal Entries {0} have been created and submitted for this expense claim.").format(
					", ".join([frappe.bold(name) for name in journal_entry_names])
				)
			else:
				message = _("Journal Entry {0} has been created and submitted for this expense claim.").format(
					frappe.bold(journal_entry_result)
				)
			frappe.msgprint(
				message,
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




