# Copyright (c) 2025, jr@gmail.com and contributors
# For license information, please see license.txt

import frappe
from frappe import _


def execute(filters=None):
	if not filters:
		filters = {}

	if not filters.get("date"):
		frappe.throw(_("Date is required"))

	if not filters.get("company"):
		frappe.throw(_("Company is required"))

	if not filters.get("entry_type"):
		frappe.throw(_("Entry Type is required"))

	entry_type = filters.get("entry_type")

	# Get columns and data based on entry type
	if entry_type == "Receipt entry":
		columns = get_receipt_entry_columns()
		data = get_receipt_entry_data(filters)
	else:  # Sales Invoice
		columns = get_sales_invoice_columns()
		data = get_sales_invoice_data(filters)

	return columns, data


def get_receipt_entry_columns():
	return [
		{
			"fieldname": "mode_of_payment",
			"label": _("Mode of Payment"),
			"fieldtype": "Data",
			"width": 150
		},
		{
			"fieldname": "customer",
			"label": _("Customer"),
			"fieldtype": "Link",
			"options": "Customer",
			"width": 150
		},
		{
			"fieldname": "quantity",
			"label": _("Qty"),
			"fieldtype": "Float",
			"width": 100
		},
		{
			"fieldname": "rate",
			"label": _("Rate"),
			"fieldtype": "Currency",
			"width": 120
		},
		{
			"fieldname": "amount",
			"label": _("Amount"),
			"fieldtype": "Currency",
			"width": 120
		}
	]


def get_sales_invoice_columns():
	return [
		{
			"fieldname": "item_code",
			"label": _("Item Code"),
			"fieldtype": "Link",
			"options": "Item",
			"width": 150
		},
		{
			"fieldname": "customer",
			"label": _("Customer"),
			"fieldtype": "Link",
			"options": "Customer",
			"width": 150
		},
		{
			"fieldname": "quantity",
			"label": _("Quantity"),
			"fieldtype": "Float",
			"width": 100
		},
		{
			"fieldname": "rate",
			"label": _("Rate"),
			"fieldtype": "Currency",
			"width": 120
		},
		{
			"fieldname": "amount",
			"label": _("Amount"),
			"fieldtype": "Currency",
			"width": 120
		}
	]


def get_receipt_entry_data(filters):
	date = filters.get("date")
	company = filters.get("company")

	# Query Sales Order items with mode of payment from Payment Entry
	data = frappe.db.sql("""
		SELECT
			COALESCE(
				(SELECT GROUP_CONCAT(DISTINCT pe.mode_of_payment SEPARATOR ', ')
				 FROM `tabPayment Entry Reference` per
				 INNER JOIN `tabPayment Entry` pe ON pe.name = per.parent
				 WHERE per.reference_name = so.name
				 AND per.reference_doctype = 'Sales Order'
				 AND pe.docstatus = 1
				 LIMIT 1),
				''
			) as mode_of_payment,
			so.customer,
			soi.qty as quantity,
			soi.rate,
			soi.amount
		FROM
			`tabSales Order Item` soi
		INNER JOIN
			`tabSales Order` so ON soi.parent = so.name
		WHERE
			DATE(so.transaction_date) = %(date)s
			AND so.company = %(company)s
			AND so.docstatus = 1
		ORDER BY
			so.name, soi.idx
	""", {
		"date": date,
		"company": company
	}, as_dict=True)

	return data


def get_sales_invoice_data(filters):
	date = filters.get("date")
	company = filters.get("company")

	# Query Sales Invoice items for the specified date and company
	data = frappe.db.sql("""
		SELECT
			sii.item_code,
			si.customer,
			sii.qty as quantity,
			sii.rate,
			sii.amount
		FROM
			`tabSales Invoice Item` sii
		INNER JOIN
			`tabSales Invoice` si ON sii.parent = si.name
		WHERE
			DATE(si.posting_date) = %(date)s
			AND si.company = %(company)s
			AND si.docstatus = 1
		ORDER BY
			sii.item_code, si.name, sii.idx
	""", {
		"date": date,
		"company": company
	}, as_dict=True)

	return data
