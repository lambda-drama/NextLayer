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
	
	# Get company currency
	company_currency = frappe.get_cached_value("Company", filters.get("company"), "default_currency") or "USD"

	# Get columns and data based on entry type
	if entry_type == "Receipt entry":
		columns = get_receipt_entry_columns(company_currency)
		data = get_receipt_entry_data(filters, company_currency)
	elif entry_type == "Payment Entry":
		columns = get_payment_entry_columns(company_currency)
		data = get_payment_entry_data(filters, company_currency)
	else:  # Sales Invoice
		columns = get_sales_invoice_columns(company_currency)
		data = get_sales_invoice_data(filters, company_currency)

	return columns, data


def get_receipt_entry_columns(company_currency="USD"):
	return [
		{
			"fieldname": "sales_order",
			"label": _("Sales Order"),
			"fieldtype": "Link",
			"options": "Sales Order",
			"width": 150
		},
		{
			"fieldname": "item_code",
			"label": _("Item Code"),
			"fieldtype": "Link",
			"options": "Item",
			"width": 150
		},
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
			"label": _("Rate ({0})").format(company_currency),
			"fieldtype": "Currency",
			"options": "currency",
			"width": 120
		},
		{
			"fieldname": "amount",
			"label": _("Amount ({0})").format(company_currency),
			"fieldtype": "Currency",
			"options": "currency",
			"width": 120
		},
		{
			"fieldname": "amount_paid",
			"label": _("Amount Paid ({0})").format(company_currency),
			"fieldtype": "Currency",
			"options": "currency",
			"width": 120
		},
		{
			"fieldname": "currency",
			"label": _("Currency"),
			"fieldtype": "Link",
			"options": "Currency",
			"hidden": 1
		}
	]


def get_sales_invoice_columns(company_currency="USD"):
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
			"label": _("Rate ({0})").format(company_currency),
			"fieldtype": "Currency",
			"options": "currency",
			"width": 120
		},
		{
			"fieldname": "amount",
			"label": _("Amount ({0})").format(company_currency),
			"fieldtype": "Currency",
			"options": "currency",
			"width": 120
		},
		{
			"fieldname": "currency",
			"label": _("Currency"),
			"fieldtype": "Link",
			"options": "Currency",
			"hidden": 1
		}
	]


def get_receipt_entry_data(filters, company_currency="USD"):
	date = filters.get("date")
	company = filters.get("company")
	
	# Ensure company is a string and strip whitespace
	if company:
		company = str(company).strip()
	
	# Query Sales Order items with mode of payment from Payment Entry
	data = frappe.db.sql("""
		SELECT
			so.name as sales_order,
			soi.item_code,
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
			soi.amount,
			so.custom_paid_amount as amount_paid,
			%(company_currency)s as currency
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
		"company": company,
		"company_currency": company_currency
	}, as_dict=True)
	
	# If no data found, check if there are Sales Orders for other companies on this date
	if not data:
		existing_companies = frappe.db.sql("""
			SELECT DISTINCT so.company
			FROM `tabSales Order` so
			WHERE DATE(so.transaction_date) = %(date)s
			AND so.docstatus = 1
		""", {"date": date}, as_dict=True)
		
		if existing_companies:
			company_list = [c.company for c in existing_companies]
			frappe.msgprint(
				_("No Sales Orders found for company '{0}' on {1}. Available companies with data: {2}").format(
					company, date, ", ".join(company_list)
				),
				indicator="orange",
				title=_("No Data Found")
			)
	
	return data


def get_sales_invoice_data(filters, company_currency="USD"):
	date = filters.get("date")
	company = filters.get("company")

	# Query Sales Invoice items for the specified date and company
	data = frappe.db.sql("""
		SELECT
			sii.item_code,
			si.customer,
			sii.qty as quantity,
			sii.rate,
			sii.amount,
			%(company_currency)s as currency
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
		"company": company,
		"company_currency": company_currency
	}, as_dict=True)

	return data


def get_payment_entry_columns(company_currency="USD"):
	return [
		{
			"fieldname": "payment_entry",
			"label": _("Payment Entry"),
			"fieldtype": "Link",
			"options": "Payment Entry",
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
			"fieldname": "amount_paid",
			"label": _("Amount Paid ({0})").format(company_currency),
			"fieldtype": "Currency",
			"options": "currency",
			"width": 120
		},
		{
			"fieldname": "sales_orders",
			"label": _("Sales Orders"),
			"fieldtype": "Data",
			"width": 200
		},
		{
			"fieldname": "currency",
			"label": _("Currency"),
			"fieldtype": "Link",
			"options": "Currency",
			"hidden": 1
		}
	]


def get_payment_entry_data(filters, company_currency="USD"):
	date = filters.get("date")
	company = filters.get("company")
	
	# Ensure company is a string and strip whitespace
	if company:
		company = str(company).strip()
	
	# Query Payment Entries with their referenced Sales Orders
	data = frappe.db.sql("""
		SELECT
			pe.name as payment_entry,
			pe.party as customer,
			pe.paid_amount as amount_paid,
			%(company_currency)s as currency,
			GROUP_CONCAT(
				DISTINCT per.reference_name 
				ORDER BY per.reference_name 
				SEPARATOR ', '
			) as sales_orders
		FROM
			`tabPayment Entry` pe
		LEFT JOIN
			`tabPayment Entry Reference` per ON per.parent = pe.name
			AND per.reference_doctype = 'Sales Order'
		WHERE
			DATE(pe.posting_date) = %(date)s
			AND pe.company = %(company)s
			AND pe.docstatus = 1
			AND pe.party_type = 'Customer'
		GROUP BY
			pe.name, pe.party, pe.paid_amount
		ORDER BY
			pe.name
	""", {
		"date": date,
		"company": company,
		"company_currency": company_currency
	}, as_dict=True)
	
	# If no data found, check if there are Payment Entries for other companies on this date
	if not data:
		existing_companies = frappe.db.sql("""
			SELECT DISTINCT pe.company
			FROM `tabPayment Entry` pe
			WHERE DATE(pe.posting_date) = %(date)s
			AND pe.docstatus = 1
			AND pe.party_type = 'Customer'
		""", {"date": date}, as_dict=True)
		
		if existing_companies:
			company_list = [c.company for c in existing_companies]
			frappe.msgprint(
				_("No Payment Entries found for company '{0}' on {1}. Available companies with data: {2}").format(
					company, date, ", ".join(company_list)
				),
				indicator="orange",
				title=_("No Data Found")
			)
	
	return data
