
# import frappe
# from frappe import _dict
# from erpnext.accounts.general_ledger import make_gl_entries

# def on_submit(doc, method=None):
# 	_make_gl_entries(doc)

# def on_cancel(doc, method=None):
# 	delete_gl_entries(doc)

# def _make_gl_entries(doc):
# 	if not doc.purchase_receipts or not len(doc.purchase_receipts):
# 		frappe.throw("Please link at least one receipt in Purchase Receipts table.")

# 	first_row = doc.purchase_receipts[0]
# 	if not first_row.receipt_document_type:
# 		frappe.throw("First row in Purchase Receipts is missing a receipt_document_type.")

# 	sales_invoice = first_row.receipt_document
# 	if not sales_invoice:
# 		frappe.throw("Could not determine Sales Invoice from Purchase Receipts child table.")

# 	# Fetch Sales Invoice details
# 	# credit_account, customer= frappe.db.get_value(
# 	# 	"Sales Invoice",
# 	# 	sales_invoice,
# 	# 	["debit_to", "customer"]
# 	# )
# 	company_abbreviation = frappe.db.get_value("Company", doc.company, "abbr")
# 	cost_center = "Main - "+ str(company_abbreviation)
# 	# Get distinct income accounts from Sales Invoice Item child table
# 	income_accounts = frappe.get_all(
# 		"Sales Invoice Item",
# 		filters={"parent": sales_invoice},
# 		fields=["income_account"]
# 	)
# 	income_accounts = list(set([row.income_account for row in income_accounts if row.income_account]))

# 	if not income_accounts:
# 		frappe.throw(f"No Income Accounts found for Sales Invoice {sales_invoice}")

# 	gl_entries = []
# 	total_amount = 0
# 		# Debit lines - expense accounts from child table
# 		# Debit lines - expense accounts from child table
# 	for row in doc.taxes:

# 		if not row.expense_account:
# 			frappe.throw("Row in Shipment Cost Distribution is missing an Expense Account.")
# 		if not row.amount:
# 			continue

# 		gl_entries.append(_dict({
# 			"account": row.expense_account,
# 			"debit": 0,   # ✅ increase expense
# 			"debit_in_account_currency": 0,
# 			"credit": row.amount,
# 			"credit_in_account_currency": row.amount,
# 			"cost_center": cost_center,
# 			"against": ",".join(income_accounts),
# 			"voucher_type": "Sales Invoice",
# 			"voucher_no": sales_invoice,
# 			"posting_date": doc.posting_date,
# 			"company": doc.company,
# 			"remarks": f"Sales Shipment Cost - {doc.name} for Sales Invoice {sales_invoice}",
# 			"branch":doc.branch,
# 			"company_group":doc.company_group,
# 			"marka":doc.marka,
# 		}))
# 		total_amount += row.amount
# 	# Credit line - Income Account(s) from Sales Invoice Items
# 	gl_entries.append(_dict({
# 		"account": income_accounts[0],
# 		"debit": total_amount,
# 		"debit_in_account_currency": total_amount,
# 		"credit": 0,   # ✅ reduce income
# 		"credit_in_account_currency": 0,
# 		"cost_center": cost_center,
# 		"against": ",".join([d.expense_account for d in doc.taxes if d.expense_account]),
# 		"voucher_type": "Sales Invoice",
# 		"voucher_no": sales_invoice,
# 		"posting_date": doc.posting_date,
# 		"company": doc.company,
# 		"remarks": f"Sales Shipment Cost - {doc.name} for Sales Invoice {sales_invoice}",
# 		"branch":doc.branch,
#         "company_group":doc.company_group,
#          "marka":doc.marka,
# 	}))


# 	make_gl_entries(gl_entries, cancel=False, update_outstanding="No")

# def delete_gl_entries(doc):
# 	frappe.db.sql("""
# 		DELETE FROM `tabGL Entry`
# 		WHERE voucher_type=%s AND voucher_no=%s
# 	""", (doc.doctype, doc.name))

import frappe
from frappe import _
from frappe.utils import flt
from erpnext.accounts.utils import get_account_currency
from erpnext.accounts.general_ledger import make_gl_entries
from nextlayer.next_layer.utils import fetch_exchange_rate

def on_submit(doc, method=None):
    _make_gl_entries(doc)

def on_cancel(doc, method=None):
    delete_gl_entries(doc)

def _make_gl_entries(doc):
    if not doc.purchase_receipts or not len(doc.purchase_receipts):
        frappe.throw(_("Please link at least one receipt in Purchase Receipts table."))

    first_row = doc.purchase_receipts[0]
    if not first_row.receipt_document_type:
        frappe.throw(_("First row in Purchase Receipts is missing a receipt_document_type."))

    sales_invoice = first_row.receipt_document
    if not sales_invoice:
        frappe.throw(_("Could not determine Sales Invoice from Purchase Receipts child table."))

    company_currency = frappe.get_cached_value("Company", doc.company, "default_currency")
    company_abbreviation = frappe.db.get_value("Company", doc.company, "abbr")
    cost_center = "Main - " + str(company_abbreviation)

    # Get distinct income accounts from Sales Invoice Item child table
    income_accounts = frappe.get_all(
        "Sales Invoice Item",
        filters={"parent": sales_invoice},
        fields=["income_account"]
    )
    income_accounts = list(set([row.income_account for row in income_accounts if row.income_account]))

    if not income_accounts:
        frappe.throw(f"No Income Accounts found for Sales Invoice {sales_invoice}")

    gl_entries = []
    total_amount_company_currency = 0
    total_amount_account_currency = 0

    # Debit expense accounts from doc.taxes
    for row in doc.taxes:
        if not row.expense_account:
            frappe.throw(_("Row in Shipment Cost Distribution is missing an Expense Account."))
        if not row.amount:
            continue

        account_currency = get_account_currency(row.expense_account) or company_currency
        exchange_rate = 1.0

        if account_currency != company_currency:
            exchange_rate = frappe.db.get_value(
                "Currency Exchange",
                {"from_currency": company_currency, "to_currency": account_currency},
                "exchange_rate"
            ) or 1.0

        amount_in_company_currency = flt(row.base_amount, 2)
        amount_in_account_currency = flt(row.amount, 2)

        gl_entries.append(frappe._dict({
            "account": row.expense_account,
            "debit": 0,
            "debit_in_account_currency": 0,
            "credit": amount_in_company_currency,
            "credit_in_transaction_currency":amount_in_account_currency,
            "credit_in_account_currency": amount_in_account_currency,
            "account_currency": account_currency,
            "cost_center": cost_center,
            "against": ",".join(income_accounts),
            "voucher_type": "Sales Invoice",
        	"voucher_no": sales_invoice,
            "posting_date": doc.posting_date,
            "company": doc.company,
            "remarks": f"Sales Shipment Cost - {doc.name} for Sales Invoice {sales_invoice}",
            "branch": doc.branch,
            "company_group": doc.company_group,
            "marka": doc.marka,
        }))
        total_amount_company_currency += amount_in_company_currency
        total_amount_account_currency += amount_in_account_currency


    # Credit Income Account(s) with total
    income_account = income_accounts[0]
    account_currency = get_account_currency(income_account) or company_currency

    gl_entries.append(frappe._dict({
        "account": income_account,
        "debit": total_amount_company_currency,
        "debit_in_transaction_currency":total_amount_account_currency,
        "debit_in_account_currency": flt(total_amount_company_currency, 2),
        "credit": 0,
        "credit_in_account_currency": 0,
        "account_currency": account_currency,
        "cost_center": cost_center,
        "against": ",".join([d.expense_account for d in doc.taxes if d.expense_account]),
        "voucher_type": "Sales Invoice",
        "voucher_no": sales_invoice,
        "posting_date": doc.posting_date,
        "company": doc.company,
        "remarks": f"Sales Shipment Cost - {doc.name} for Sales Invoice {sales_invoice}",
        "branch": doc.branch,
        "company_group": doc.company_group,
        "marka": doc.marka,
    }))

    make_gl_entries(gl_entries, cancel=False, update_outstanding="No")

def delete_gl_entries(doc):
    frappe.db.sql("""
        DELETE FROM `tabGL Entry`
        WHERE voucher_type=%s AND voucher_no=%s
    """, (doc.doctype, doc.name))

def update_landed_cost_rows(doc, method):
    company_currency = doc.company_currency
    for row in doc.taxes:  # child table = Sales Landed Cost Taxes and Charges
        if row.expense_account:
            account_currency = frappe.db.get_value("Account", row.expense_account, "account_currency")
            if account_currency and account_currency != company_currency:
                rate = fetch_exchange_rate(account_currency, company_currency, doc.posting_date)
                row.exchange_rate = flt(rate) or 1
                row.base_amount = flt(row.amount) * flt(row.exchange_rate)
            else:
                row.exchange_rate = 1
                row.base_amount = row.amount
