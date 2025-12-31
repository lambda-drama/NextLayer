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

	columns = get_columns()
	data = get_data(filters)

	return columns, data


def get_columns():
	return [
		{
			"fieldname": "mode_of_payment",
			"label": _("Mode of Payment"),
			"fieldtype": "Data",
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


def get_data(filters):
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
