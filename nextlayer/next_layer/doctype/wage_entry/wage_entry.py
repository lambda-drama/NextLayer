# Copyright (c) 2026, jr@gmail.com and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document
from frappe.utils import flt, nowdate
from frappe import _


class WageEntry(Document):
	def validate(self):
		self.calculate_totals()
  
	def before_save(self):
		self.generate_work_type_breakdown()

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
  
	def generate_work_type_breakdown(self):
		# Group wages by type_of_work
		groups = {}
		for row in self.wages:
			key = row.type_of_work or 'Unspecified'
			if key not in groups:
				groups[key] = {'total_amount': 0, 'total_qty': 0, 'workers': 0}
			groups[key]['total_amount'] += (row.amount or 0)
			groups[key]['total_qty']    += (row.qty or 1)
			groups[key]['workers']      += 1

		# Clear existing breakdown and rebuild
		self.type_of_work_breakdown = []

		for work_type, data in groups.items():
			self.append('type_of_work_breakdown', {
				'type_of_work':  work_type,
				'total_amount':  data['total_amount'],
				'total_qty':     data['total_qty'],
				'no_of_workers': data['workers']
			})


# In your Wage Entry doctype controller
# File: next_layer/next_layer/doctype/wage_entry/wage_entry.py



# @frappe.whitelist()
# def make_journal_entry(wage_entry_name):
# 	doc = frappe.get_doc("Wage Entry", wage_entry_name)

# 	if not doc.default_expense_account:
# 		frappe.throw(_("Please set a Default Expense Account on this Wage Entry before booking."))

# 	if not doc.default_payable_account:
# 		frappe.throw(_("Please set a Default Payable Account on this Wage Entry before booking."))

# 	# Check not already booked
# 	existing = frappe.db.exists("Journal Entry", {
# 		"user_remark": "Wages - " + wage_entry_name,
# 		"docstatus": 1
# 	})
# 	if existing:
# 		frappe.throw(_("A Journal Entry already exists for this Wage Entry: {0}").format(existing))

# 	# Group wages by type_of_work
# 	groups = {}
# 	for row in doc.wages:
# 		key = row.type_of_work or "General"
# 		groups[key] = groups.get(key, 0) + (row.amount or 0)

# 	total = sum(groups.values())

# 	if total <= 0:
# 		frappe.throw(_("Total wage amount must be greater than zero."))

# 	# Build journal entry accounts
# 	accounts = []

# 	# One debit row per work type
# 	for work_type, amount in groups.items():
# 		accounts.append({
# 			"account": doc.default_expense_account,
# 			"debit_in_account_currency": amount,
# 			"credit_in_account_currency": 0,
# 			"project": doc.project or "",
# 			"cost_center": doc.cost_center or "",
# 			"user_remark": work_type
# 		})

# 	# Single credit row
# 	accounts.append({
# 		"account": doc.default_payable_account,
# 		"debit_in_account_currency": 0,
# 		"credit_in_account_currency": total,
# 		"project": doc.project or "",
# 		"cost_center": doc.cost_center or ""
# 	})

# 	jv = frappe.get_doc({
# 		"doctype": "Journal Entry",
# 		"voucher_type": "Journal Entry",
# 		"posting_date": doc.date or nowdate(),
# 		"company": doc.company,
# 		"user_remark": "Wages - " + wage_entry_name,
# 		"accounts": accounts,
# 		"multi_currency":1,
# 		"branch":doc.branch
# 	})

# 	jv.insert(ignore_permissions=True)
# 	jv.submit()

# 	# Save reference back on Wage Entry
# 	frappe.db.set_value("Wage Entry", wage_entry_name, "journal_entry", jv.name)

# 	return jv.name

from frappe.utils import nowdate
from frappe import _
import frappe

# @frappe.whitelist()
# def make_journal_entry(wage_entry_name):
#     doc = frappe.get_doc("Wage Entry", wage_entry_name)

#     if not doc.default_expense_account:
#         frappe.throw(_("Please set a Default Expense Account before booking."))

#     if not doc.default_payable_account:
#         frappe.throw(_("Please set a Default Payable Account before booking."))

#     if doc.journal_entry:
#         frappe.throw(_("Journal Entry {0} already exists for this Wage Entry.").format(doc.journal_entry))

#     total = sum(row.amount or 0 for row in doc.wages)

#     if total <= 0:
#         frappe.throw(_("Total wage amount must be greater than zero."))

#     # Currency resolution (mirrors BonusPayout pattern)
#     company_currency = frappe.db.get_value("Company", doc.company, "default_currency")
#     expense_account_currency = frappe.db.get_value("Account", doc.default_expense_account, "account_currency")
#     payable_account_currency = frappe.db.get_value("Account", doc.default_payable_account, "account_currency")
#     conversion_rate = getattr(doc, "conversion_rate", None) or 1

#     accounts = []

#     # --- DEBIT: one row per work type on the expense account ---
#     groups = {}
#     for row in doc.wages:
#         key = row.type_of_work or "General"
#         groups[key] = groups.get(key, 0) + (row.amount or 0)

#     for work_type, amount in groups.items():
#         accounts.append({
#             "account": doc.default_expense_account,
#             "debit_in_account_currency": amount,
#             "credit_in_account_currency": 0,
#             "project": doc.project or "",
#             "cost_center": doc.cost_center or "",
#             "user_remark": work_type,
#             "exchange_rate": conversion_rate if company_currency != expense_account_currency else 1,
#             "company_group": doc.company_group or "",
#         })

#     # --- CREDIT: payable account row, with party if provided ---
#     credit_row = {
#         "account": doc.default_payable_account,
#         "debit_in_account_currency": 0,
#         "credit_in_account_currency": total,
#         "project": doc.project or "",
#         "cost_center": doc.cost_center or "",
#         "exchange_rate": conversion_rate if company_currency != payable_account_currency else 1,
#         "company_group": doc.company_group or "",
#         "reference_type": doc.doctype,   # links JE back to Wage Entry
#         "reference_name": doc.name,
#     }

#     # Attach party only if both fields are filled (mirrors BonusPayout per-party rows)
#     if doc.party_type and doc.party:
#         credit_row["party_type"] = doc.party_type
#         credit_row["party"] = doc.party

#     accounts.append(credit_row)

#     jv = frappe.get_doc({
#         "doctype": "Journal Entry",
#         "voucher_type": "Journal Entry",
#         "posting_date": doc.date or nowdate(),
#         "company": doc.company,
#         "title": doc.default_payable_account,
#         "user_remark": "Wages - " + wage_entry_name,
#         "accounts": accounts,
#         # Only enable multi_currency when doc currency differs from company currency
#         "multi_currency": 1 if (doc.currency and doc.currency != company_currency) else 0,
#         "branch": doc.branch or "",
#     })

#     jv.insert(ignore_permissions=True)
#     jv.submit()

#     frappe.db.set_value("Wage Entry", wage_entry_name, "journal_entry", jv.name)

#     return jv.name

@frappe.whitelist()
def make_journal_entry(wage_entry_name, amount=None):
    doc = frappe.get_doc("Wage Entry", wage_entry_name)

    if not doc.default_expense_account:
        frappe.throw(_("Please set a Default Expense Account before booking."))
    if not doc.default_payable_account:
        frappe.throw(_("Please set a Default Payable Account before booking."))

    total_wages = sum(row.amount or 0 for row in doc.wages)
    if total_wages <= 0:
        frappe.throw(_("Total wage amount must be greater than zero."))

    # Use passed amount, fallback to full total
    payment_amount = float(amount) if amount else total_wages
    if payment_amount <= 0:
        frappe.throw(_("Payment amount must be greater than zero."))

    company_currency         = frappe.db.get_value("Company", doc.company, "default_currency")
    expense_account_currency = frappe.db.get_value("Account", doc.default_expense_account, "account_currency")
    payable_account_currency = frappe.db.get_value("Account", doc.default_payable_account, "account_currency")
    conversion_rate          = getattr(doc, "conversion_rate", None) or 1

    accounts = []

    # --- DEBIT: split proportionally across work types ---
    groups = {}
    for row in doc.wages:
        key = row.type_of_work or "General"
        groups[key] = groups.get(key, 0) + (row.amount or 0)

    for work_type, work_amount in groups.items():
        # Prorate this work type's share of the payment amount
        prorated = (work_amount / total_wages) * payment_amount if total_wages else payment_amount
        accounts.append({
            "account":                    doc.default_expense_account,
            "debit_in_account_currency":  prorated,
            "credit_in_account_currency": 0,
            "project":                    doc.project or "",
            "cost_center":                doc.cost_center or "",
            "user_remark":                work_type,
            "exchange_rate":              conversion_rate if company_currency != expense_account_currency else 1,
            "company_group":              doc.company_group or "",
        })

    # --- CREDIT: payable account ---
    credit_row = {
        "account":                    doc.default_payable_account,
        "debit_in_account_currency":  0,
        "credit_in_account_currency": payment_amount,
        "project":                    doc.project or "",
        "cost_center":                doc.cost_center or "",
        "exchange_rate":              conversion_rate if company_currency != payable_account_currency else 1,
        "company_group":              doc.company_group or "",
        "reference_type":             "Wage Entry",
        "reference_name":             wage_entry_name,
    }

    if doc.party_type and doc.party:
        credit_row["party_type"] = doc.party_type
        credit_row["party"]      = doc.party

    accounts.append(credit_row)

    jv = frappe.get_doc({
        "doctype":        "Journal Entry",
        "voucher_type":   "Journal Entry",
        "posting_date":   doc.date or nowdate(),
        "company":        doc.company,
        "title":          doc.default_payable_account,
        "user_remark":    f"Wages – {wage_entry_name}",
        "accounts":       accounts,
        "multi_currency": 1 if (doc.currency and doc.currency != company_currency) else 0,
        "branch":         doc.branch or "",
    })

    jv.insert(ignore_permissions=True)
    jv.submit()

    update_wage_entry_payment_status(wage_entry_name)

    return jv.name


def update_wage_entry_payment_status(wage_entry_name):
    doc          = frappe.get_doc("Wage Entry", wage_entry_name)
    total_amount = float(doc.get("total_amount") or 0)

    result = frappe.db.sql("""
        SELECT COALESCE(SUM(jea.credit_in_account_currency), 0)
        FROM   `tabJournal Entry Account` jea
        JOIN   `tabJournal Entry`         je  ON je.name = jea.parent
        WHERE  jea.reference_type = 'Wage Entry'
        AND    jea.reference_name  = %(name)s
        AND    je.docstatus         = 1
    """, {"name": wage_entry_name})

    total_paid = float(result[0][0] or 0) if result else 0.0

    if total_amount > 0 and total_paid >= total_amount:
        new_status = "Paid"
    elif total_paid > 0:
        new_status = "Partly Paid"
    else:
        new_status = "Unpaid"

    if doc.get("status") != new_status:
        frappe.db.set_value("Wage Entry", wage_entry_name, "status", new_status)
        frappe.msgprint(
            _("Wage Entry {0} status updated to <b>{1}</b>. Paid: {2} of {3}.").format(
                wage_entry_name, new_status, total_paid, total_amount
            ),
            indicator="green" if new_status == "Paid" else ("orange" if new_status == "Partly Paid" else "red"),
            alert=True,
        )

@frappe.whitelist()
def get_allowed_whatsapp_groups() -> list:
	"""
	Return WhatsApp groups the current user is permitted to message.
 
	Rules:
	  - System Manager sees all groups.
	  - If a group's user_permissions table is EMPTY → accessible by everyone.
	  - If a group's user_permissions table has rows → only listed users can see it.
	"""
	current_user = frappe.session.user
	
	# System Manager bypass
	if "System Manager" in frappe.get_roles(current_user):
		return frappe.get_all(
			"Whatsapp Group Profile",
			fields=["name", "group_name"],
			order_by="group_name asc",
		)
 
	all_groups = frappe.get_all(
		"Whatsapp Group Profile",
		fields=["name", "group_name"],
		order_by="group_name asc",
	)
 
	allowed = []
	for group in all_groups:
		total_permissions = frappe.db.count(
			"WhatsApp Group Access",
			filters={"parent": group["name"]},
		)
 
		if total_permissions == 0:
			# No restrictions — everyone can access
			allowed.append(group)
		elif frappe.db.exists(
			"WhatsApp Group Access",
			{"parent": group["name"], "user": current_user},
		):
			allowed.append(group)
	return allowed
 