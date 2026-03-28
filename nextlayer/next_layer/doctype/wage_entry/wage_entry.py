# Copyright (c) 2026, jr@gmail.com and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document
from frappe.utils import flt, nowdate
from frappe import _


class WageEntry(Document):
	def validate(self):
		self.calculate_totals()

	def calculate_totals(self):
		"""Set amount per row (qty * rate) and total_qty, total_amount on main doc."""
		total_qty = 0
		total_amount = 0
		for row in self.wages or []:
			qty = flt(row.get("qty"), 0)
			rate = flt(row.get("rate"), 0)
			row.amount = qty * rate
			total_qty += qty
			total_amount += row.amount
		self.total_qty = total_qty
		self.total_amount = total_amount


# In your Wage Entry doctype controller
# File: next_layer/next_layer/doctype/wage_entry/wage_entry.py



@frappe.whitelist()
def make_journal_entry(wage_entry_name):
    doc = frappe.get_doc("Wage Entry", wage_entry_name)

    if not doc.default_expense_account:
        frappe.throw(_("Please set a Default Expense Account on this Wage Entry before booking."))

    if not doc.default_payable_account:
        frappe.throw(_("Please set a Default Payable Account on this Wage Entry before booking."))

    # Check not already booked
    existing = frappe.db.exists("Journal Entry", {
        "user_remark": "Wages - " + wage_entry_name,
        "docstatus": 1
    })
    if existing:
        frappe.throw(_("A Journal Entry already exists for this Wage Entry: {0}").format(existing))

    # Group wages by type_of_work
    groups = {}
    for row in doc.wages:
        key = row.type_of_work or "General"
        groups[key] = groups.get(key, 0) + (row.amount or 0)

    total = sum(groups.values())

    if total <= 0:
        frappe.throw(_("Total wage amount must be greater than zero."))

    # Build journal entry accounts
    accounts = []

    # One debit row per work type
    for work_type, amount in groups.items():
        accounts.append({
            "account": doc.default_expense_account,
            "debit_in_account_currency": amount,
            "credit_in_account_currency": 0,
            "project": doc.project or "",
            "cost_center": doc.cost_center or "",
            "user_remark": work_type
        })

    # Single credit row
    accounts.append({
        "account": doc.default_payable_account,
        "debit_in_account_currency": 0,
        "credit_in_account_currency": total,
        "project": doc.project or "",
        "cost_center": doc.cost_center or ""
    })

    jv = frappe.get_doc({
        "doctype": "Journal Entry",
        "voucher_type": "Journal Entry",
        "posting_date": doc.date or nowdate(),
        "company": doc.company,
        "user_remark": "Wages - " + wage_entry_name,
        "accounts": accounts,
        "multi_currency":1,
        "branch":doc.branch
    })

    jv.insert(ignore_permissions=True)
    jv.submit()

    # Save reference back on Wage Entry
    frappe.db.set_value("Wage Entry", wage_entry_name, "journal_entry", jv.name)

    return jv.name