
import frappe
from frappe import _dict
from erpnext.accounts.general_ledger import make_gl_entries

def on_submit(doc, method=None):
	_make_gl_entries(doc)

def on_cancel(doc, method=None):
	delete_gl_entries(doc)

def _make_gl_entries(doc):
	if not doc.purchase_receipts or not len(doc.purchase_receipts):
		frappe.throw("Please link at least one receipt in Purchase Receipts table.")

	first_row = doc.purchase_receipts[0]
	if not first_row.receipt_document_type:
		frappe.throw("First row in Purchase Receipts is missing a receipt_document_type.")

	sales_invoice = first_row.receipt_document
	if not sales_invoice:
		frappe.throw("Could not determine Sales Invoice from Purchase Receipts child table.")

	# Fetch Sales Invoice details
	credit_account, customer, cost_center = frappe.db.get_value(
		"Sales Invoice",
		sales_invoice,
		["debit_to", "customer", "cost_center"]
	)

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
	total_amount = 0
	cost_center = ""
		# Debit lines - expense accounts from child table
		# Debit lines - expense accounts from child table
	for row in doc.taxes:
		cost_center = row.cost_center
		if not row.expense_account:
			frappe.throw("Row in Shipment Cost Distribution is missing an Expense Account.")
		if not row.amount:
			continue

		gl_entries.append(_dict({
			"account": row.expense_account,
			"debit": row.amount,   # ✅ increase expense
			"debit_in_account_currency": row.amount,
			"credit": 0,
			"credit_in_account_currency": 0,
			"cost_center": cost_center,
			"against": ",".join(income_accounts),
			"voucher_type": "Sales Invoice",
			"voucher_no": sales_invoice,
			"posting_date": doc.posting_date,
			"company": doc.company,
			"remarks": f"Sales Shipment Cost - {doc.name} for Sales Invoice {sales_invoice}"
		}))
		total_amount += row.amount

	# Credit line - Income Account(s) from Sales Invoice Items
	gl_entries.append(_dict({
		"account": income_accounts[0],
		"debit": 0,
		"debit_in_account_currency": 0,
		"credit": total_amount,   # ✅ reduce income
		"credit_in_account_currency": total_amount,
		"cost_center": cost_center or "Main - CW",
		"against": ",".join([d.expense_account for d in doc.taxes if d.expense_account]),
		"voucher_type": "Sales Invoice",
		"voucher_no": sales_invoice,
		"posting_date": doc.posting_date,
		"company": doc.company,
		"remarks": f"Sales Shipment Cost - {doc.name} for Sales Invoice {sales_invoice}"
	}))


	make_gl_entries(gl_entries, cancel=False, update_outstanding="No")

def delete_gl_entries(doc):
	frappe.db.sql("""
		DELETE FROM `tabGL Entry`
		WHERE voucher_type=%s AND voucher_no=%s
	""", (doc.doctype, doc.name))
