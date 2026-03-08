# Copyright (c) 2026, jr@gmail.com and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document


class TravelExpenseSettings(Document):
	pass


@frappe.whitelist()
def get_restricted_accounts_for_journal():
	"""
	When apply_this_account_restriction_on_journal is ticked in NextLayer Settings,
	return list of account names from travel_expense_accounts table.
	These accounts must not appear in Journal Entry account selection.
	Returns empty list if setting is off or no accounts configured.
	"""
	try:
		if not frappe.db.exists("Travel Expense Settings", "Travel Expense Settings"):
			return []
		doc = frappe.get_single("Travel Expense Settings")
		if not doc.get("apply_this_account_restriction_on_journal"):
			return []
		accounts = []
		for row in doc.get("travel_expense_accounts") or []:
			if row.get("account"):
				accounts.append(row.account)
		return list(set(accounts))
	except Exception:
		return []
