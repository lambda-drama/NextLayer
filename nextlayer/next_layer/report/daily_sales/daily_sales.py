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
			"fieldname": "item_code",
			"label": _("Item Code"),
			"fieldtype": "Link",
			"options": "Item",
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


def get_data(filters):
	date = filters.get("date")
	company = filters.get("company")

	# Query Sales Order items for the specified date and company
	data = frappe.db.sql("""
		SELECT
			soi.item_code,
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
			soi.item_code, so.name, soi.idx
	""", {
		"date": date,
		"company": company
	}, as_dict=True)

	return data
