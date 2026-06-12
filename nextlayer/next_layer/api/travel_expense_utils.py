# Copyright (c) 2025, Next Layer and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.utils import flt, get_link_to_form
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
	
	# Expense Claim Type → child table "accounts" (Expense Claim Account: company + default_account)
	account_field = "default_account"
	if not frappe.db.has_column("Expense Claim Account", "default_account"):
		if frappe.db.has_column("Expense Claim Account", "account"):
			account_field = "account"
		else:
			frappe.throw(
				_("Expense Claim Account table is missing account columns. Please run bench migrate.")
			)

	account = frappe.db.get_value(
		"Expense Claim Account",
		{"parent": expense_type, "company": company},
		account_field,
	)

	if account:
		return account

	_throw_missing_expense_claim_account(expense_type, company, account_field)


def _throw_missing_expense_claim_account(expense_type, company, account_field="default_account"):
	"""Tell the user exactly what to fix when Expense Claim Type has no GL account for a company."""
	expense_type_link = get_link_to_form("Expense Claim Type", expense_type)
	company_link = get_link_to_form("Company", company)

	rows = frappe.get_all(
		"Expense Claim Account",
		filters={"parent": expense_type},
		fields=["company", account_field],
	)

	if not rows:
		frappe.throw(
			_(
				"No expense account is configured for {0}. "
				"Open {1}, go to the <b>Accounts</b> table, add a row for company {2}, "
				"and set the <b>Default Account</b> before creating the journal entry."
			).format(frappe.bold(expense_type), expense_type_link, company_link),
			title=_("Expense Account Missing"),
		)

	company_row = next((r for r in rows if r.get("company") == company), None)
	if company_row and not company_row.get(account_field):
		frappe.throw(
			_(
				"{0} has a row for company {1}, but <b>Default Account</b> is empty. "
				"Open {2}, edit the Accounts row for this company, and select an expense account."
			).format(frappe.bold(expense_type), company_link, expense_type_link),
			title=_("Expense Account Missing"),
		)

	configured_companies = ", ".join(
		frappe.bold(r.company) for r in rows if r.get("company") and r.get(account_field)
	)
	frappe.throw(
		_(
			"{0} has no expense account set for company {1}. "
			"Open {2}, go to the <b>Accounts</b> table, add a row for {1}, "
			"and set the <b>Default Account</b>."
			"{3}"
		).format(
			frappe.bold(expense_type),
			company_link,
			expense_type_link,
			(
				"<br><br>"
				+ _("Accounts are currently configured for: {0}.").format(configured_companies)
				if configured_companies
				else ""
			),
		),
		title=_("Expense Account Missing"),
	)


@frappe.whitelist()
def create_additional_travel_expense(original_travel_expense, expense_items, company=None, traveler_name=None, transaction_currency=None, expense_category=None, cash_account=None):
	"""
	Add Refund or Additional expense rows to the same Travel Expense (More Information table).
	Does not create a new Travel Expense document.

	Args:
		original_travel_expense: Name of the original Travel Expense
		expense_items: List of travel expense detail items
		company: Company (optional, will use from original if not provided)
		traveler_name: Traveler Name (optional, unused; kept for API compatibility)
		transaction_currency: Transaction currency from modal (optional)
		expense_category: "Refund" or "Additional" (optional)
		cash_account: Cash/Bank account for lost amount in refunds (optional; kept for API compatibility)

	Returns:
		dict: Success status and travel expense name (same as original)
	"""
	try:
		# Parse expense_items if it's a JSON string
		if isinstance(expense_items, str):
			import json
			expense_items = json.loads(expense_items)
		
		# Get original travel expense (do not create a new one)
		original_te = frappe.get_doc("Travel Expense", original_travel_expense)
		
		# Get company currency
		company_currency = frappe.get_cached_value("Company", company or original_te.company, "default_currency")
		
		# Set transaction currency (use provided currency or default to company currency)
		if not transaction_currency:
			transaction_currency = getattr(original_te, 'currency', None) or company_currency
		
		# entry_type for More Information: "Refund" or "Additional"
		entry_type = "Refund" if expense_category == "Refund" else "Additional"
		
		# Ensure more_information table exists on the doc
		if not hasattr(original_te, 'more_information') or original_te.more_information is None:
			original_te.more_information = []
		
		def safe_get(data, key, default=None):
			if isinstance(data, dict):
				return data.get(key, default)
			if hasattr(data, key):
				return getattr(data, key, default)
			return default
		
		# Add each expense item as a row in More Information only
		for item in expense_items:
			if isinstance(item, str):
				import json
				try:
					item = json.loads(item)
				except Exception:
					item = {}
			elif not isinstance(item, dict):
				try:
					item = dict(item) if (hasattr(item, '__dict__') or hasattr(item, 'keys')) else {}
				except Exception:
					item = {}
			
			amount = safe_get(item, "amount", 0)
			amount_company_currency = safe_get(item, "amount_company_currency")
			
			# Convert to company currency if needed
			if amount and transaction_currency != company_currency and not amount_company_currency:
				try:
					transaction_date = safe_get(item, "expense_date") or original_te.posting_date or frappe.utils.today()
					exchange_rate = get_exchange_rate(
						transaction_currency,
						company_currency,
						transaction_date,
						original_te.company
					)
					amount_company_currency = amount * exchange_rate
				except Exception as e:
					frappe.log_error(f"Error converting amount for more_information: {str(e)}", "Travel Expense Currency Conversion")
					amount_company_currency = amount
			elif amount and (not amount_company_currency or transaction_currency == company_currency):
				amount_company_currency = amount_company_currency or amount
			
			row = {
				"entry_type": entry_type,
				"journal_created": 0,
				"expense_type": safe_get(item, "expense_type"),
				"expense_date": safe_get(item, "expense_date") or frappe.utils.today(),
				"amount": amount,
				"amount_company_currency": amount_company_currency,
				"description": safe_get(item, "description"),
				"cost_center": safe_get(item, "cost_center"),
				"project": safe_get(item, "project"),
			}
			# Remove None values so defaults apply where needed
			row = {k: v for k, v in row.items() if v is not None}
			original_te.append("more_information", row)
		
		# Save the same document (no new Travel Expense)
		# Use flags to ignore validate_update_after_submit for submitted docs
		if not hasattr(original_te, "flags"):
			original_te.flags = frappe._dict()
		original_te.flags.ignore_validate_update_after_submit = True
		original_te.save(ignore_permissions=True)
		frappe.db.commit()
		
		# Create journal entries for the new More Information rows (same as refund/additional used to)
		original_te.reload()
		create_journal_entries_for_more_information(original_te)
		frappe.db.commit()
		
		return {
			"success": True,
			"travel_expense_name": original_te.name,
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


def create_journal_entries_for_more_information(travel_expense):
	"""
	Create Journal Entries for Travel Expense More Information rows where journal_created = 0.
	- Refund: Use original vs refund logic (credit original expense, debit payment/payable, debit expense for lost amount).
	- Additional: Debit expense account, Credit payment/payable account (same as normal expense JE).
	"""
	if not getattr(travel_expense, "more_information", None):
		return
	company = travel_expense.company
	company_currency = frappe.get_cached_value("Company", company, "default_currency")
	posting_date_base = getattr(travel_expense, "posting_date", None) or frappe.utils.today()
	traveler = getattr(travel_expense, "traveler_name", None)
	is_paid = getattr(travel_expense, "is_paid", 0)
	direct_payment_account = getattr(travel_expense, "direct_payment_account", None)
	payable_account = getattr(travel_expense, "payable_account", None) or frappe.db.get_value("Company", company, "default_payable_account")
	# Split rows: refunds vs additionals
	refund_rows = []
	additional_rows = []
	for row in travel_expense.more_information:
		if getattr(row, "journal_created", 0):
			continue
		entry_type = (getattr(row, "entry_type", None) or "Additional").strip()
		if entry_type == "Refund":
			refund_rows.append(row)
		else:
			additional_rows.append(row)

	# Handle Additional rows: one JE per row (same as normal expense logic)
	for row in additional_rows:
		expense_type = getattr(row, "expense_type", None)
		if not expense_type:
			frappe.log_error(f"More Information row missing expense_type (parent={travel_expense.name})", "Travel Expense More Information JE")
			continue
		amount = getattr(row, "amount_company_currency", None) or getattr(row, "amount", None) or 0
		if not amount or amount <= 0:
			frappe.db.set_value(
				"Travel Expense More Information", row.name,
				{"journal_created": 1, "journal_entry": None}
			)
			continue

		expense_account = get_expense_account_from_expense_type(expense_type, company)
		cost_center = getattr(row, "cost_center", None) or getattr(travel_expense, "cost_center", None)
		project = getattr(row, "project", None) or getattr(travel_expense, "project", None)
		posting_date = getattr(row, "expense_date", None) or posting_date_base

		expense_account_currency = frappe.db.get_value("Account", expense_account, "account_currency") or company_currency
		if expense_account_currency == company_currency:
			expense_base = amount
		else:
			try:
				expense_base = amount * get_exchange_rate(expense_account_currency, company_currency, posting_date, company)
			except Exception:
				expense_base = amount

		je_accounts = [{
			"account": expense_account,
			"debit_in_account_currency": amount,
			"debit": expense_base,
			"cost_center": cost_center,
			"project": project,
			"reference_type": "Travel Expense",
			"reference_name": travel_expense.name,
		}]

		# Credit side: direct payment (if paid) or payable (if unpaid)
		if is_paid and direct_payment_account:
			pay_account = direct_payment_account
			pay_currency = frappe.db.get_value("Account", pay_account, "account_currency") or company_currency
		else:
			pay_account = payable_account
			pay_currency = frappe.db.get_value("Account", pay_account, "account_currency") or company_currency

		if not pay_account:
			frappe.throw(_("Payable Account or Direct Payment Account is required for Travel Expense {0}.").format(travel_expense.name))

		if pay_currency == company_currency:
			pay_base = amount
			pay_amount = amount
		else:
			try:
				pay_amount = amount * get_exchange_rate(company_currency, pay_currency, posting_date, company)
				pay_base = amount
			except Exception:
				pay_amount = amount
				pay_base = amount

		acc_entry = {
			"account": pay_account,
			"credit_in_account_currency": pay_amount,
			"credit": pay_base,
			"cost_center": cost_center,
			"project": project,
			"reference_type": "Travel Expense",
			"reference_name": travel_expense.name,
		}
		if not is_paid and pay_account == payable_account and traveler:
			acc_entry["party_type"] = "Member"
			acc_entry["party"] = traveler
		je_accounts.append(acc_entry)

		remark = f"Travel Expense {travel_expense.name} - More Information (Additional)"
		if getattr(row, "description", None) and str(row.description).strip():
			remark += "\n" + str(row.description).strip()

		account_currencies = {expense_account_currency, pay_currency}
		is_multi_currency = any(c != company_currency for c in account_currencies)

		je = frappe.get_doc({
			"doctype": "Journal Entry",
			"voucher_type": "Journal Entry",
			"company": company,
			"posting_date": posting_date,
			"multi_currency": 1 if is_multi_currency else 0,
			"user_remark": remark,
			"accounts": je_accounts,
		})

		if is_multi_currency:
			je.currency = expense_account_currency if expense_account_currency != company_currency else pay_currency
			try:
				je.exchange_rate = get_exchange_rate(je.currency, company_currency, posting_date, company)
			except Exception:
				je.exchange_rate = 1

		if getattr(travel_expense, "company_group", None):
			je.company_group = travel_expense.company_group
		if getattr(travel_expense, "branch", None):
			je.branch = travel_expense.branch

		je.insert(ignore_permissions=True)
		je.submit()
		frappe.db.set_value(
			"Travel Expense More Information", row.name,
			{"journal_created": 1, "journal_entry": je.name}
		)

	# Handle Refund rows: single JE using original vs refund logic (3 lines)
	if refund_rows:
		# Total refund amount for this batch
		refund_amount = 0
		for row in refund_rows:
			amt = getattr(row, "amount_company_currency", None) or getattr(row, "amount", None) or 0
			if amt and amt > 0:
				refund_amount += amt

		if refund_amount > 0:
			je_name = create_refund_journal_for_travel_expense(travel_expense, refund_amount)
			if je_name:
				for row in refund_rows:
					frappe.db.set_value(
						"Travel Expense More Information", row.name,
						{"journal_created": 1, "journal_entry": je_name}
					)


def create_refund_journal_for_travel_expense(original_te, refund_amount):
	"""
	Create a refund Journal Entry for a Travel Expense using the original vs refund logic:
	1) Credit original expense accounts for the full original amount
	2) Debit payment/payable for refund_amount
	3) Debit expense accounts for lost_amount (original_total - refund_amount), pro‑rated
	"""
	if refund_amount <= 0:
		return None

	company = original_te.company
	company_doc = frappe.get_doc("Company", company)
	company_currency = company_doc.default_currency

	# Original totals and expense accounts from original Travel Expense
	original_total = getattr(original_te, "grand_total_company_currency", None) or getattr(original_te, "total_company_currency", None) or 0
	if original_total <= 0:
		frappe.throw(_("Cannot create refund journal: original travel expense total is zero or negative."))

	lost_amount = original_total - refund_amount
	if lost_amount < 0:
		frappe.throw(_("Refund amount cannot exceed original expense amount"))

	posting_date = getattr(original_te, "posting_date", None) or frappe.utils.today()

	# Build original expense accounts (same as old refund logic)
	original_expense_accounts = {}
	if original_te.expenses:
		for expense_row in original_te.expenses:
			expense_type = expense_row.expense_type
			if not expense_type:
				continue
			expense_account = get_expense_account_from_expense_type(expense_type, company)
			expense_amt = getattr(expense_row, "amount_company_currency", None) or expense_row.amount or 0
			if expense_amt <= 0:
				continue
			if expense_account in original_expense_accounts:
				original_expense_accounts[expense_account] += expense_amt
			else:
				original_expense_accounts[expense_account] = expense_amt

	if not original_expense_accounts:
		frappe.throw(_("Cannot create refund journal: no expense accounts found on original travel expense."))

	traveler = getattr(original_te, "traveler_name", None)
	payable_account = getattr(original_te, "payable_account", None) or frappe.db.get_value("Company", company, "default_payable_account")
	payable_account_currency = frappe.db.get_value("Account", payable_account, "account_currency") or company_currency if payable_account else company_currency

	je_accounts = []

	# 1. Credit Expense Account(s) - reverse the FULL original expense amount
	for expense_account, original_amt in original_expense_accounts.items():
		expense_account_currency = frappe.db.get_value("Account", expense_account, "account_currency") or company_currency
		if expense_account_currency == company_currency:
			expense_base = original_amt
		else:
			try:
				exchange_rate = get_exchange_rate(expense_account_currency, company_currency, posting_date, company)
				expense_base = original_amt * exchange_rate
			except Exception:
				expense_base = original_amt

		cost_center = getattr(original_te, "cost_center", None)
		project = getattr(original_te, "project", None)
		if original_te.expenses and len(original_te.expenses) > 0:
			first_row = original_te.expenses[0]
			if first_row.cost_center:
				cost_center = first_row.cost_center
			if first_row.project:
				project = first_row.project

		je_accounts.append({
			"account": expense_account,
			"credit_in_account_currency": original_amt,
			"credit": expense_base,
			"cost_center": cost_center,
			"project": project,
			"reference_type": "Travel Expense",
				"reference_name": original_te.name,
		})

	# 2. Debit payment / payable for refund_amount
	original_is_paid = getattr(original_te, "is_paid", 0)
	original_payment_account = None
	if original_is_paid and getattr(original_te, "direct_payment_account", None):
		original_payment_account = original_te.direct_payment_account
	else:
		original_payment_account = company_doc.default_bank_account or company_doc.default_cash_account
	if not original_payment_account:
		original_payment_account = frappe.db.get_value("Account", {"company": company, "account_type": "Bank", "is_group": 0}, "name")
	if not original_payment_account:
		original_payment_account = frappe.db.get_value("Account", {"company": company, "account_type": "Cash", "is_group": 0}, "name")

	if original_is_paid:
		# Refund back to bank/cash
		if not original_payment_account:
			frappe.throw(_("Please set Default Bank Account or Default Cash Account in Company settings"))
		payment_account_currency = frappe.db.get_value("Account", original_payment_account, "account_currency") or company_currency
		if payment_account_currency == company_currency:
			payment_base = refund_amount
			payment_amt = refund_amount
		else:
			try:
				ex_rate = get_exchange_rate(company_currency, payment_account_currency, posting_date, company)
				payment_amt = refund_amount * ex_rate
				payment_base = refund_amount
			except Exception:
				payment_amt = refund_amount
				payment_base = refund_amount

		je_accounts.append({
			"account": original_payment_account,
			"debit_in_account_currency": payment_amt,
			"debit": payment_base,
			"cost_center": original_te.cost_center,
			"project": original_te.project,
			"reference_type": "Travel Expense",
				"reference_name": original_te.name,
		})
	else:
		# Refund reduces payable
		if not payable_account:
			frappe.throw(_("Please set Payable Account in Travel Expense or Company settings"))
		if payable_account_currency == company_currency:
			payable_base = refund_amount
			payable_amt = refund_amount
		else:
			try:
				ex_rate = get_exchange_rate(company_currency, payable_account_currency, posting_date, company)
				payable_amt = refund_amount * ex_rate
				payable_base = refund_amount
			except Exception:
				payable_amt = refund_amount
				payable_base = refund_amount

		acc = {
			"account": payable_account,
			"debit_in_account_currency": payable_amt,
			"debit": payable_base,
			"cost_center": original_te.cost_center,
			"project": original_te.project,
			"reference_type": "Travel Expense",
				"reference_name": original_te.name,
		}
		if traveler:
			acc["party_type"] = "Member"
			acc["party"] = traveler
		je_accounts.append(acc)

	# 3. Debit Expense Account(s) for lost amount (if any), pro‑rated
	if lost_amount > 0 and original_total > 0:
		for expense_account, original_amt in original_expense_accounts.items():
			if not expense_account or original_amt <= 0:
				continue
			account_lost_amount = lost_amount * (original_amt / original_total)
			expense_account_currency = frappe.db.get_value("Account", expense_account, "account_currency") or company_currency
			if expense_account_currency == company_currency:
				expense_base = account_lost_amount
			else:
				try:
					ex_rate = get_exchange_rate(expense_account_currency, company_currency, posting_date, company)
					expense_base = account_lost_amount * ex_rate
				except Exception:
					expense_base = account_lost_amount

			cost_center = original_te.cost_center
			project = original_te.project
			if original_te.expenses and len(original_te.expenses) > 0:
				first_row = original_te.expenses[0]
				if first_row.cost_center:
					cost_center = first_row.cost_center
				if first_row.project:
					project = first_row.project

			je_accounts.append({
				"account": expense_account,
				"debit_in_account_currency": account_lost_amount,
				"debit": expense_base,
				"cost_center": cost_center,
				"project": project,
				"reference_type": "Travel Expense",
				"reference_name": original_te.name,
			})

	# Multi‑currency determination (reuse pattern from main JE logic)
	account_currencies = set()
	for acc in original_expense_accounts.keys():
		if not acc:
			continue
		curr = frappe.db.get_value("Account", acc, "account_currency") or company_currency
		account_currencies.add(curr)
	if payable_account:
		curr = frappe.db.get_value("Account", payable_account, "account_currency") or company_currency
		account_currencies.add(curr)
	if original_payment_account:
		curr = frappe.db.get_value("Account", original_payment_account, "account_currency") or company_currency
		account_currencies.add(curr)
	is_multi_currency = any(curr != company_currency for curr in account_currencies)

	# Final tiny-balance guard (handles rounding noise like 0.0009999)
	
	remark = f"Travel Expense {original_te.name} - Refund"

	je = frappe.get_doc({
		"doctype": "Journal Entry",
		"voucher_type": "Journal Entry",
		"company": company,
		"posting_date": posting_date,
		"multi_currency": 1 if is_multi_currency else 0,
		"user_remark": remark,
		"accounts": je_accounts,
	})

	if is_multi_currency:
		primary_currency = company_currency
		try:
			je.exchange_rate = get_exchange_rate(primary_currency, company_currency, posting_date, company)
		except Exception:
			je.exchange_rate = 1

	if getattr(original_te, "company_group", None):
		je.company_group = original_te.company_group
	if getattr(original_te, "branch", None):
		je.branch = original_te.branch

	je.insert(ignore_permissions=True)
	je.submit()

	return je.name


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
				# Safe getattr – may not exist on all sites
				cash_in_hand_account = getattr(travel_expense, 'custom_cash_account', None)
			if not cash_in_hand_account:
				# Try to get from database (in case it was set but not loaded),
				# but only if the column exists to avoid SQL errors.
				try:
					if frappe.db.has_column("Travel Expense", "custom_cash_account"):
						cash_in_hand_account = frappe.db.get_value(
							"Travel Expense", travel_expense.name, "custom_cash_account"
						)
				except Exception:
					cash_in_hand_account = None
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
					"reference_type": "Travel Expense",
			"reference_name": travel_expense.name,
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
					"reference_type": "Travel Expense",
			"reference_name": travel_expense.name,
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
					"reference_type": "Travel Expense",
			"reference_name": travel_expense.name,
				})
			
			# 3. Debit Expense Account(s) for lost amount (if any)
			# Lost amount should hit the same expense accounts defined on the Expense Claim Type
			# (pro-rated based on the original amounts per account).
			if lost_amount > 0 and original_total > 0:
				for expense_account, original_amount in original_expense_accounts.items():
					if not expense_account or original_amount <= 0:
						continue

					# Pro-rate lost amount based on original share of each expense account
					account_lost_amount = lost_amount * (original_amount / original_total)

					expense_account_currency = frappe.db.get_value("Account", expense_account, "account_currency") or company_currency

					# Calculate base amount
					if expense_account_currency == company_currency:
						expense_base_amount = account_lost_amount
					else:
						try:
							exchange_rate = get_exchange_rate(
								expense_account_currency,
								company_currency,
								posting_date,
								company
							)
							expense_base_amount = account_lost_amount * exchange_rate
						except Exception:
							expense_base_amount = account_lost_amount

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
						"debit_in_account_currency": account_lost_amount,
						"debit": expense_base_amount,
						"cost_center": cost_center,
						"project": project,
						"reference_type": "Travel Expense",
			"reference_name": travel_expense.name,
					})
		else:
			# Normal expense (not refund) - original logic
			# 1. Debit Expense Account(s)
			# amount is in company currency; base (debit) = company amount; debit_in_account_currency = convert to account currency when different
			for expense_account, amount in expense_accounts.items():
				expense_account_currency = frappe.db.get_value("Account", expense_account, "account_currency") or company_currency
				# Base amount is always in company currency
				expense_base_amount = amount
				if expense_account_currency == company_currency:
					expense_amount_in_account_currency = amount
				else:
					try:
						# get_exchange_rate(from, to) = to per from → amount_in_account = amount * rate
						exchange_rate = get_exchange_rate(
							company_currency,
							expense_account_currency,
							posting_date,
							company
						)
						expense_amount_in_account_currency = amount * exchange_rate
					except Exception:
						expense_amount_in_account_currency = amount
				
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
					"debit_in_account_currency": expense_amount_in_account_currency,
					"debit": expense_base_amount,
					"cost_center": cost_center,
					"project": project,
					"reference_type": "Travel Expense",
			"reference_name": travel_expense.name,
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
				"reference_type": "Travel Expense",
			"reference_name": travel_expense.name,
			})
		
		# Determine if multi-currency
		# Consider all accounts used in this JE (including refund-specific accounts)
		account_currencies = set()

		# Expense side accounts:
		if is_refund:
			# Refund uses original_expense_accounts (from original expense)
			original_expense_accounts = locals().get("original_expense_accounts") or {}
			source_accounts = original_expense_accounts.keys()
		else:
			source_accounts = expense_accounts.keys()

		for acc in source_accounts:
			if not acc:
				continue
			curr = frappe.db.get_value("Account", acc, "account_currency") or company_currency
			account_currencies.add(curr)

		# Payable account (used for normal unpaid expenses and unpaid refunds)
		if not is_refund or (is_refund and not getattr(locals().get("original_te", None), "is_paid", 0)):
			if payable_account:
				curr = frappe.db.get_value("Account", payable_account, "account_currency") or company_currency
				account_currencies.add(curr)

		# Original payment account (used when original expense was paid and we're refunding)
		if is_refund:
			original_payment_account = locals().get("original_payment_account")
			if original_payment_account:
				curr = frappe.db.get_value("Account", original_payment_account, "account_currency") or company_currency
				account_currencies.add(curr)

			# Cash-in-hand account for lost amount (if any)
			cash_in_hand_account = locals().get("cash_in_hand_account")
			if cash_in_hand_account:
				curr = frappe.db.get_value("Account", cash_in_hand_account, "account_currency") or company_currency
				account_currencies.add(curr)

		is_multi_currency = any(curr != company_currency for curr in account_currencies)
		# Final tiny-balance guard (handles rounding noise like 0.0009999)
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
		
		# Build expense account entries from expenses child table
		if not travel_expense.expenses:
			frappe.throw(_("No expenses found. Please add expenses before submitting."))
		
		# Check if this is a refund
		is_refund = getattr(travel_expense, 'refund', 0)
		
		# Get posting date and transaction currency once (used for amounts and exchange)
		posting_date = getattr(travel_expense, 'posting_date', None) or frappe.utils.today()
		transaction_currency = getattr(travel_expense, 'currency', None) or company_currency

		# Validate all expense rows have expense type and get expense accounts.
		# Store both company-currency amount (for JE base/debit) and account-currency amount (for debit_in_account_currency)
		# so that e.g. Visa (USD) is debited with 68 USD, not 249.65 AED.
		expense_accounts = {}  # account -> {"company_currency": x, "account_currency": y}
		total_expense_amount = 0
		for expense_row in travel_expense.expenses:
			expense_type = expense_row.expense_type
			if not expense_type:
				frappe.throw(_("Expense Type is required for all expense rows"))
			
			# Get expense account from Expense Claim Type and its currency
			expense_account = get_expense_account_from_expense_type(expense_type, company)
			expense_account_currency = frappe.db.get_value("Account", expense_account, "account_currency") or company_currency

			# Company-currency amount (for JE base amount)
			amount_company = getattr(expense_row, 'amount_company_currency', None)
			if not amount_company or amount_company == 0:
				transaction_amount = getattr(expense_row, 'amount', None) or 0
				if transaction_amount and transaction_amount > 0:
					if transaction_currency != company_currency:
						try:
							exchange_rate = get_exchange_rate(
								transaction_currency,
								company_currency,
								posting_date,
								company
							)
							amount_company = transaction_amount * exchange_rate
						except Exception:
							amount_company = transaction_amount
					else:
						amount_company = transaction_amount
				else:
					amount_company = 0
			
			if amount_company <= 0:
				continue

			# Amount in expense account currency (for debit_in_account_currency)
			# get_exchange_rate(from, to) returns "to per from" → amount_in_to = amount_in_from * rate
			if expense_account_currency == company_currency:
				amount_in_account_currency = amount_company
			elif expense_account_currency == transaction_currency:
				# Account is in transaction currency: use row amount if entered, else convert company amount
				amount_in_account_currency = getattr(expense_row, 'amount', None) or 0
				if not amount_in_account_currency and amount_company:
					try:
						rate = get_exchange_rate(company_currency, transaction_currency, posting_date, company)
						if rate is not None and flt(rate) > 0:
							amount_in_account_currency = amount_company * rate
						else:
							rev = get_exchange_rate(transaction_currency, company_currency, posting_date, company)
							if rev is not None and flt(rev) > 0:
								amount_in_account_currency = amount_company / rev
							else:
								amount_in_account_currency = amount_company
					except Exception:
						amount_in_account_currency = amount_company
			else:
				# Expense account in different currency (e.g. document AED, account USD): convert company amount to account currency.
				# JE overwrites base debit with debit_in_account_currency * exchange_rate, so we must never pass 0.
				try:
					rate = get_exchange_rate(company_currency, expense_account_currency, posting_date, company)
					if rate is not None and flt(rate) > 0:
						amount_in_account_currency = amount_company * rate
					else:
						rev = get_exchange_rate(expense_account_currency, company_currency, posting_date, company)
						if rev is not None and flt(rev) > 0:
							amount_in_account_currency = amount_company / rev
						else:
							frappe.throw(_(
								"Exchange rate required from {0} to {1} (or reverse) for date {2} for expense account {3}. Please set up in Currency Exchange."
							).format(company_currency, expense_account_currency, posting_date, expense_account))
				except frappe.ValidationError:
					raise
				except Exception as e:
					frappe.throw(_(
						"Could not convert amount to expense account currency ({0}): {1}. Please set up exchange rate in Currency Exchange."
					).format(expense_account_currency, str(e)))
				if not amount_in_account_currency or flt(amount_in_account_currency) <= 0:
					frappe.throw(_(
						"Exchange rate from {0} to {1} for date {2} returned zero or invalid. Please set up in Currency Exchange."
					).format(company_currency, expense_account_currency, posting_date))
			
			# Group by expense account (sum both currencies)
			if expense_account in expense_accounts:
				expense_accounts[expense_account]["company_currency"] += amount_company
				expense_accounts[expense_account]["account_currency"] += amount_in_account_currency
			else:
				expense_accounts[expense_account] = {"company_currency": amount_company, "account_currency": amount_in_account_currency}
			
			total_expense_amount += amount_company
		
		# Validate that we have at least one expense account with amount > 0
		if not expense_accounts or total_expense_amount <= 0:
			frappe.throw(_("Cannot create journal entry: No valid expense amounts found. Please ensure expenses have amounts set in company currency."))
		
		# Get total amount (use company currency amount)
		# Use calculated total_expense_amount or fallback to grand_total_company_currency
		total_amount = total_expense_amount
		grand_total = getattr(travel_expense, 'grand_total_company_currency', None) or getattr(travel_expense, 'total_company_currency', None) or 0
		
		# If grand_total includes taxes, use it; otherwise use sum of expenses
		if grand_total > 0:
			total_amount = grand_total
		
		if total_amount <= 0:
			frappe.throw(_("Cannot create journal entry: Travel expense grand total is zero or negative ({0}). Please ensure expenses are added and amounts are set correctly.").format(total_amount))
		
		# Get direct payment account
		direct_payment_account = travel_expense.direct_payment_account
		
		# Get account currencies
		account_currency_value = frappe.db.get_value("Account", direct_payment_account, "account_currency")
		direct_payment_account_currency = account_currency_value if account_currency_value else company_currency
		
		# Log currency info for debugging
		frappe.logger().debug(f"Travel Expense {travel_expense.name}: Company currency={company_currency}, Payment account={direct_payment_account}, Account currency={direct_payment_account_currency}, Total amount={total_amount}")
		
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
				# Safe getattr – may not exist on all sites
				cash_in_hand_account = getattr(travel_expense, 'custom_cash_account', None)
			if not cash_in_hand_account:
				# Try to get from database (in case it was set but not loaded),
				# but only if the column exists to avoid SQL errors.
				try:
					if frappe.db.has_column("Travel Expense", "custom_cash_account"):
						cash_in_hand_account = frappe.db.get_value(
							"Travel Expense", travel_expense.name, "custom_cash_account"
						)
				except Exception:
					cash_in_hand_account = None
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
					"reference_type": "Travel Expense",
			"reference_name": travel_expense.name,
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
			
			# For the direct payment (bank/cash) line in refund flow, also let JE compute
			# the base debit from debit_in_account_currency to avoid tiny rounding gaps.
			je_accounts.append({
				"account": direct_payment_account,
				"debit_in_account_currency": flt(payment_amount, 2),
				# Intentionally omit \"debit\"; JE will derive it.
				"cost_center": travel_expense.cost_center,
				"project": travel_expense.project,
				"reference_type": "Travel Expense",
				"reference_name": travel_expense.name,
			})
			
			# 3. Debit Expense Account(s) for lost amount (if any)
			# Lost amount should hit the same expense accounts defined on the Expense Claim Type
			# (pro-rated based on the original amounts per account).
			if lost_amount > 0 and original_total > 0:
				for expense_account, original_amount in original_expense_accounts.items():
					if not expense_account or original_amount <= 0:
						continue

					# Pro-rate lost amount based on original share of each expense account
					account_lost_amount = lost_amount * (original_amount / original_total)

					expense_account_currency = frappe.db.get_value("Account", expense_account, "account_currency") or company_currency

					# Calculate base amount
					if expense_account_currency == company_currency:
						expense_base_amount = account_lost_amount
					else:
						try:
							exchange_rate = get_exchange_rate(
								expense_account_currency,
								company_currency,
								posting_date,
								company
							)
							expense_base_amount = account_lost_amount * exchange_rate
						except Exception:
							expense_base_amount = account_lost_amount

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
						"debit_in_account_currency": account_lost_amount,
						"debit": expense_base_amount,
						"cost_center": cost_center,
						"project": project,
						"reference_type": "Travel Expense",
			"reference_name": travel_expense.name,
					})
		else:
			# Normal expense (not refund) - original logic
			# 1. Debit Expense Account(s)
			for expense_account, amounts in expense_accounts.items():
				amount_company = amounts["company_currency"]
				amount_in_account_currency = amounts["account_currency"]
				# Validate amount is not zero
				if amount_company <= 0:
					frappe.throw(_("Cannot create journal entry: Expense account {0} has zero or negative amount ({1}). Please check expense amounts.").format(
						expense_account, amount_company
					))
				
				expense_account_currency = frappe.db.get_value("Account", expense_account, "account_currency") or company_currency
				
				# Base amount is always in company currency (for JE totals)
				expense_base_amount = amount_company
				
				# Validate base amount is not zero
				if expense_base_amount <= 0:
					frappe.throw(_("Cannot create journal entry: Expense account {0} has zero base amount. Company amount: {1}.").format(
						expense_account, amount_company
					))
				
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
					"debit_in_account_currency": amount_in_account_currency,
					"debit": expense_base_amount,
					"cost_center": cost_center,
					"project": project,
					"reference_type": "Travel Expense",
			"reference_name": travel_expense.name,
				})
		
			# 2. Credit Direct Payment Account
			# Calculate sum of all debit base amounts (company currency) to ensure credit matches
			total_debit_amount = sum(amt["company_currency"] for amt in expense_accounts.values())
			
			# Use total_debit_amount if total_amount is zero or doesn't match
			if total_amount <= 0 or abs(total_amount - total_debit_amount) > 0.01:
				total_amount = total_debit_amount
			
			if total_amount <= 0:
				frappe.throw(_("Cannot create journal entry: Total amount is zero. Please ensure expenses have valid amounts."))
			
			# Check if currencies are actually the same (even if account_currency is None, it defaults to company currency)
			if direct_payment_account_currency == company_currency or not account_currency_value:
				# Same currency or account currency not set (defaults to company currency)
				payment_base_amount = total_amount
				payment_amount = total_amount
				frappe.logger().debug(f"Using same currency: payment_amount={payment_amount}, payment_base_amount={payment_base_amount}")
			else:
				# Direct payment account is in different currency
				payment_exchange_rate = None
				try:
					# First, try to get exchange rate from company currency to payment account currency
					payment_exchange_rate = get_exchange_rate(
						company_currency,
						direct_payment_account_currency,
						posting_date,
						company
					)
					
					frappe.logger().debug(f"Exchange rate lookup (direct): from={company_currency}, to={direct_payment_account_currency}, date={posting_date}, rate={payment_exchange_rate}")
					
					# If direct rate is not found or is zero, try reverse rate
					if payment_exchange_rate is None or payment_exchange_rate <= 0:
						frappe.logger().debug(f"Direct exchange rate not found or invalid ({payment_exchange_rate}), trying reverse rate...")
						
						try:
							# Try to get reverse exchange rate (from payment account currency to company currency)
							reverse_rate = get_exchange_rate(
								direct_payment_account_currency,
								company_currency,
								posting_date,
								company
							)
							
							frappe.logger().debug(f"Exchange rate lookup (reverse): from={direct_payment_account_currency}, to={company_currency}, date={posting_date}, rate={reverse_rate}")
							
							# If reverse rate is valid, calculate inverse
							if reverse_rate and reverse_rate > 0:
								payment_exchange_rate = 1.0 / reverse_rate
								frappe.logger().debug(f"Using inverse of reverse rate: {reverse_rate} -> {payment_exchange_rate}")
							else:
								payment_exchange_rate = None
						except Exception as reverse_error:
							frappe.logger().debug(f"Reverse exchange rate lookup also failed: {str(reverse_error)}")
							payment_exchange_rate = None
					
					# Validate exchange rate is valid
					if payment_exchange_rate is None:
						frappe.throw(_("Exchange rate not found from {0} to {1} (or reverse) for date {2}. Please set up exchange rate in Currency Exchange.").format(
							company_currency,
							direct_payment_account_currency,
							posting_date
						))
					
					if payment_exchange_rate <= 0:
						frappe.throw(_("Invalid exchange rate ({0}) from {1} to {2} for date {3}. Exchange rate must be greater than zero. Please set up exchange rate in Currency Exchange.").format(
							payment_exchange_rate,
							company_currency,
							direct_payment_account_currency,
							posting_date
						))
					
					payment_amount = total_amount * payment_exchange_rate
					# Base amount is in company currency
					payment_base_amount = total_amount
					
					frappe.logger().debug(f"Currency conversion: total_amount={total_amount}, exchange_rate={payment_exchange_rate}, payment_amount={payment_amount}")
					
					# Validate calculated payment amount is not zero
					if payment_amount <= 0:
						frappe.throw(_("Cannot create journal entry: Payment amount is zero after currency conversion. Total amount: {0}, Exchange rate: {1}, Payment amount: {2}. Please check exchange rate setup.").format(
							total_amount, payment_exchange_rate, payment_amount
						))
					
				except frappe.ValidationError:
					# Re-raise validation errors
					raise
				except Exception as e:
					# If exchange rate lookup fails, throw error with details
					error_msg = str(e)
					frappe.logger().error(f"Exchange rate lookup failed: {error_msg}")
					frappe.throw(_("Cannot create journal entry: Failed to get exchange rate from {0} to {1} for date {2}. Error: {3}. Please set up exchange rate in Currency Exchange.").format(
						company_currency,
						direct_payment_account_currency,
						posting_date,
						error_msg
					))
			
			# Validate credit amount is not zero (final check)
			if payment_amount <= 0 or payment_base_amount <= 0:
				frappe.throw(_("Cannot create journal entry: Credit amount is zero. Total amount: {0}, Payment amount: {1}, Payment base amount: {2}, Account currency: {3}, Company currency: {4}").format(
					total_amount, payment_amount, payment_base_amount, direct_payment_account_currency, company_currency
				))
			
			# For the direct payment (bank/cash) line, let Frappe compute the base credit
			# from credit_in_account_currency and the JE exchange rate to avoid tiny
			# floating point imbalances between debit and credit.
			je_accounts.append({
				"account": direct_payment_account,
				"credit_in_account_currency": flt(payment_amount, 2),
				# Intentionally omit \"credit\" here; JE will derive it.
				"cost_center": travel_expense.cost_center,
				"project": travel_expense.project,
				"reference_type": "Travel Expense",
				"reference_name": travel_expense.name,
			})
		
		# Determine if multi-currency
		# Consider all accounts used in this JE (including refund-specific accounts)
		account_currencies = set()

		# Expense side accounts:
		if is_refund:
			# Refund uses original_expense_accounts (from original expense)
			original_expense_accounts = locals().get("original_expense_accounts") or {}
			source_accounts = original_expense_accounts.keys()
		else:
			source_accounts = expense_accounts.keys()

		for acc in source_accounts:
			if not acc:
				continue
			curr = frappe.db.get_value("Account", acc, "account_currency") or company_currency
			account_currencies.add(curr)

		# Direct payment account (always used in paid flow)
		if direct_payment_account:
			curr = frappe.db.get_value("Account", direct_payment_account, "account_currency") or company_currency
			account_currencies.add(curr)

		# Cash-in-hand account for lost amount (if any, in refund flow)
		if is_refund:
			cash_in_hand_account = locals().get("cash_in_hand_account")
			if cash_in_hand_account:
				curr = frappe.db.get_value("Account", cash_in_hand_account, "account_currency") or company_currency
				account_currencies.add(curr)

		is_multi_currency = any(curr != company_currency for curr in account_currencies)
		
		# Final tiny-balance guard (handles rounding noise like 0.0009999)
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
				AND reference_type = 'Travel Expense' AND reference_name = %s
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
				"reference_type": "Travel Expense",
				"reference_name": travel_expense_name,
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


@frappe.whitelist()
def check_journal_entry_exists(travel_expense_name):
	"""
	Check if a Journal Entry exists for the Travel Expense (read-only check).
	This is used to determine if the "Create Journal" button should be shown.
	
	Args:
		travel_expense_name: Name of the Travel Expense document
	
	Returns:
		dict: Success status and whether journal entry exists
	"""
	try:
		# Check if Journal Entry already exists
		existing_je = frappe.db.sql("""
			SELECT name, docstatus
			FROM `tabJournal Entry`
			WHERE EXISTS (
				SELECT 1 FROM `tabJournal Entry Account`
				WHERE parent = `tabJournal Entry`.name
				AND reference_type = 'Travel Expense' AND reference_name = %s
			)
			ORDER BY creation DESC
			LIMIT 1
		""", (travel_expense_name,), as_dict=True)
		
		if existing_je:
			je_name = existing_je[0].name
			je_status = "Submitted" if existing_je[0].docstatus == 1 else "Draft"
			return {
				"success": True,
				"journal_entry_name": je_name,
				"already_exists": True,
				"status": je_status
			}
		else:
			return {
				"success": True,
				"already_exists": False
			}
		
	except Exception as e:
		frappe.log_error(f"Error checking journal entry: {str(e)}", "Travel Expense Utils Error")
		return {
			"success": False,
			"error": str(e),
			"already_exists": False
		}


@frappe.whitelist()
def check_and_create_journal_entry(travel_expense_name):
	"""
	Check if a Journal Entry exists for the Travel Expense, and create one if it doesn't.
	This is useful when journal entry creation failed during submission.
	
	Args:
		travel_expense_name: Name of the Travel Expense document
	
	Returns:
		dict: Success status and journal entry name (if created) or existing journal entry name
	"""
	try:
		# Reload document from database to ensure fresh data
		frappe.db.commit()  # Ensure any pending changes are saved
		travel_expense = frappe.get_doc("Travel Expense", travel_expense_name)
		
		# Create journal entries for any More Information rows not yet journaled
		create_journal_entries_for_more_information(travel_expense)
		frappe.db.commit()
		travel_expense.reload()
		
		# Check if document is submitted
		if travel_expense.docstatus != 1:
			return {
				"success": False,
				"error": "Travel expense must be submitted before creating journal entry."
			}
		
		# Check if already cancelled
		if travel_expense.is_cancelled:
			return {
				"success": False,
				"error": "Cannot create journal entry for a cancelled travel expense."
			}
		
		# Recalculate totals to ensure they are up to date
		if hasattr(travel_expense, 'calculate_totals'):
			travel_expense.calculate_totals()
			# Save totals to ensure they're persisted
			travel_expense.db_set('grand_total_company_currency', travel_expense.grand_total_company_currency)
			travel_expense.db_set('total_company_currency', travel_expense.total_company_currency)
			# Reload to get fresh data
			travel_expense.reload()
		
		# Validate totals before proceeding
		total_amount = getattr(travel_expense, 'grand_total_company_currency', None) or getattr(travel_expense, 'total_company_currency', None) or 0
		if total_amount <= 0:
			return {
				"success": False,
				"error": f"Cannot create journal entry: Travel expense grand total is zero or negative ({total_amount}). Please ensure expenses are added and amounts are set correctly."
			}
		
		# Check if Journal Entry already exists
		existing_je = frappe.db.sql("""
			SELECT name, docstatus
			FROM `tabJournal Entry`
			WHERE EXISTS (
				SELECT 1 FROM `tabJournal Entry Account`
				WHERE parent = `tabJournal Entry`.name
				AND reference_type = 'Travel Expense' AND reference_name = %s
			)
			ORDER BY creation DESC
			LIMIT 1
		""", (travel_expense_name,), as_dict=True)
		
		if existing_je:
			je_name = existing_je[0].name
			je_status = "Submitted" if existing_je[0].docstatus == 1 else "Draft"
			return {
				"success": True,
				"journal_entry_name": je_name,
				"message": f"Journal Entry {je_name} already exists ({je_status}).",
				"already_exists": True
			}
		
		# No Journal Entry exists, create one
		# Use the same logic as on_submit based on is_paid status
		if travel_expense.is_paid:
			journal_entry_name = create_journal_entry_for_paid_travel_expense(travel_expense)
		else:
			journal_entry_name = create_journal_entry_for_travel_expense(travel_expense)
		
		if journal_entry_name:
			return {
				"success": True,
				"journal_entry_name": journal_entry_name,
				"message": f"Journal Entry {journal_entry_name} has been created and submitted.",
				"already_exists": False
			}
		else:
			return {
				"success": False,
				"error": "Failed to create journal entry."
			}
		
	except Exception as e:
		frappe.log_error(f"Error checking/creating journal entry: {str(e)}", "Travel Expense Utils Error")
		return {
			"success": False,
			"error": str(e)
		}


def clear_more_information_on_je_cancel(je_name):
	"""
	When a Journal Entry is cancelled, reset Travel Expense More Information rows
	that were linked to it: set journal_created = 0 and journal_entry = None.
	"""
	if not je_name:
		return
	rows = frappe.db.get_all(
		"Travel Expense More Information",
		filters={"journal_entry": je_name},
		pluck="name",
	)
	for row_name in rows:
		frappe.db.set_value(
			"Travel Expense More Information",
			row_name,
			{"journal_created": 0, "journal_entry": None},
		)


@frappe.whitelist()
def create_journal_for_more_information_row(travel_expense_name, row_name):
	"""
	Create the Journal Entry for a single More Information row (when user clicks Create Journal on that row).
	Respects entry_type: Additional = normal expense JE; Refund = 3-line refund JE for that row's amount.
	Returns dict with success and journal_entry_name or error.
	"""
	try:
		travel_expense = frappe.get_doc("Travel Expense", travel_expense_name)
		row = None
		for r in (travel_expense.more_information or []):
			if r.name == row_name:
				row = r
				break
		if not row:
			return {"success": False, "error": _("Row not found in More Information.")}
		if getattr(row, "journal_created", 0):
			return {"success": False, "error": _("Journal already created for this row.")}

		entry_type = (getattr(row, "entry_type", None) or "Additional").strip()
		amount = getattr(row, "amount_company_currency", None) or getattr(row, "amount", None) or 0
		if not amount or amount <= 0:
			return {"success": False, "error": _("Row amount must be greater than zero.")}

		if entry_type == "Refund":
			je_name = create_refund_journal_for_travel_expense(travel_expense, amount)
			if je_name:
				frappe.db.set_value(
					"Travel Expense More Information", row_name,
					{"journal_created": 1, "journal_entry": je_name},
				)
		else:
			# Additional: create one JE for this row (reuse same logic as batch Additional)
			_create_single_additional_je_for_row(travel_expense, row)
			je_name = frappe.db.get_value("Travel Expense More Information", row_name, "journal_entry")

		if je_name:
			return {"success": True, "journal_entry_name": je_name}
		return {"success": False, "error": _("Failed to create journal entry.")}
	except Exception as e:
		frappe.log_error(str(e), "Travel Expense More Information Create Journal")
		return {"success": False, "error": str(e)}


def _create_single_additional_je_for_row(travel_expense, row):
	"""Create one Additional JE for a single More Information row and set journal_created + journal_entry."""
	company = travel_expense.company
	company_currency = frappe.get_cached_value("Company", company, "default_currency")
	posting_date_base = getattr(travel_expense, "posting_date", None) or frappe.utils.today()
	traveler = getattr(travel_expense, "traveler_name", None)
	is_paid = getattr(travel_expense, "is_paid", 0)
	direct_payment_account = getattr(travel_expense, "direct_payment_account", None)
	payable_account = getattr(travel_expense, "payable_account", None) or frappe.db.get_value("Company", company, "default_payable_account")

	expense_type = getattr(row, "expense_type", None)
	if not expense_type:
		frappe.throw(_("Expense Type is required for this row."))
	amount = getattr(row, "amount_company_currency", None) or getattr(row, "amount", None) or 0
	if not amount or amount <= 0:
		frappe.throw(_("Amount must be greater than zero."))

	expense_account = get_expense_account_from_expense_type(expense_type, company)
	cost_center = getattr(row, "cost_center", None) or getattr(travel_expense, "cost_center", None)
	project = getattr(row, "project", None) or getattr(travel_expense, "project", None)
	posting_date = getattr(row, "expense_date", None) or posting_date_base

	expense_account_currency = frappe.db.get_value("Account", expense_account, "account_currency") or company_currency
	if expense_account_currency == company_currency:
		expense_base = amount
	else:
		try:
			expense_base = amount * get_exchange_rate(expense_account_currency, company_currency, posting_date, company)
		except Exception:
			expense_base = amount

	je_accounts = [{
		"account": expense_account,
		"debit_in_account_currency": amount,
		"debit": expense_base,
		"cost_center": cost_center,
		"project": project,
		"reference_type": "Travel Expense",
			"reference_name": travel_expense.name,
	}]

	if is_paid and direct_payment_account:
		pay_account = direct_payment_account
		pay_currency = frappe.db.get_value("Account", pay_account, "account_currency") or company_currency
	else:
		pay_account = payable_account
		pay_currency = frappe.db.get_value("Account", pay_account, "account_currency") or company_currency
	if not pay_account:
		frappe.throw(_("Payable Account or Direct Payment Account is required for Travel Expense."))
	pay_base = pay_amount = amount
	if pay_currency != company_currency:
		try:
			pay_amount = amount * get_exchange_rate(company_currency, pay_currency, posting_date, company)
		except Exception:
			pass
	acc_entry = {"account": pay_account, "credit_in_account_currency": pay_amount, "credit": pay_base, "cost_center": cost_center, "project": project, "reference_type": "Travel Expense",
			"reference_name": travel_expense.name}
	if not is_paid and pay_account == payable_account and traveler:
		acc_entry["party_type"] = "Member"
		acc_entry["party"] = traveler
	je_accounts.append(acc_entry)

	remark = f"Travel Expense {travel_expense.name} - More Information (Additional)"
	if getattr(row, "description", None) and str(row.description).strip():
		remark += "\n" + str(row.description).strip()
	account_currencies = {expense_account_currency, pay_currency}
	is_multi_currency = any(c != company_currency for c in account_currencies)
	je = frappe.get_doc({
		"doctype": "Journal Entry",
		"voucher_type": "Journal Entry",
		"company": company,
		"posting_date": posting_date,
		"multi_currency": 1 if is_multi_currency else 0,
		"user_remark": remark,
		"accounts": je_accounts,
	})
	if is_multi_currency:
		je.currency = expense_account_currency if expense_account_currency != company_currency else pay_currency
		try:
			je.exchange_rate = get_exchange_rate(je.currency, company_currency, posting_date, company)
		except Exception:
			je.exchange_rate = 1
	if getattr(travel_expense, "company_group", None):
		je.company_group = travel_expense.company_group
	if getattr(travel_expense, "branch", None):
		je.branch = travel_expense.branch
	je.insert(ignore_permissions=True)
	je.submit()
	frappe.db.set_value("Travel Expense More Information", row.name, {"journal_created": 1, "journal_entry": je.name})

