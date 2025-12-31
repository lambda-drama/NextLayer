# Copyright (c) 2025, jr@gmail.com and contributors
# For license information, please see license.txt

import frappe
from frappe import _


def execute(filters=None):
	if not filters:
		filters = {}
	
	if not filters.get("company"):
		frappe.throw(_("Company is required"))
	
	if not filters.get("doctype"):
		frappe.throw(_("DocType is required"))
	
	if not filters.get("from_date") or not filters.get("to_date"):
		frappe.throw(_("Date From and Date To are required"))
	
	doctype = filters.get("doctype")
	
	# Get columns and data based on doctype
	if doctype == "Sales Order":
		columns = get_sales_order_columns()
		data = get_sales_order_data(filters)
	elif doctype == "Sales Invoice":
		columns = get_sales_invoice_columns()
		data = get_sales_invoice_data(filters)
	elif doctype == "Payment Entry":
		columns = []
		data = []
	elif doctype == "Salary Advance":
		columns = []
		data = []
	elif doctype == "Purchase Invoice":
		columns = get_purchase_invoice_columns()
		data = get_purchase_invoice_data(filters)
	elif doctype == "Expense Claim":
		columns = []
		data = []
	else:
		columns = []
		data = []
	
	return columns, data


def get_sales_order_columns():
	return [
		{
			"fieldname": "name",
			"label": _("Name"),
			"fieldtype": "Link",
			"options": "Sales Order",
			"width": 120
		},
		{
			"fieldname": "reference_no",
			"label": _("Reference No"),
			"fieldtype": "Data",
			"width": 120
		},
		{
			"fieldname": "customer",
			"label": _("Customer"),
			"fieldtype": "Link",
			"options": "Customer",
			"width": 150
		},
		{
			"fieldname": "item_code",
			"label": _("Item Code"),
			"fieldtype": "Link",
			"options": "Item",
			"width": 120
		},
		{
			"fieldname": "discount",
			"label": _("Discount"),
			"fieldtype": "Currency",
			"width": 100
		},
		{
			"fieldname": "mode_of_payment",
			"label": _("Mode of Payment"),
			"fieldtype": "Data",
			"width": 120
		},
		{
			"fieldname": "total_qty",
			"label": _("Total Qty"),
			"fieldtype": "Float",
			"width": 100
		},
		{
			"fieldname": "total_paid",
			"label": _("Total Paid"),
			"fieldtype": "Currency",
			"width": 120
		}
	]


def get_sales_order_data(filters):
	conditions = []
	params = {
		"company": filters.get("company"),
		"from_date": filters.get("from_date"),
		"to_date": filters.get("to_date")
	}
	
	conditions.append("so.company = %(company)s")
	conditions.append("DATE(so.transaction_date) BETWEEN %(from_date)s AND %(to_date)s")
	conditions.append("so.docstatus = 1")
	
	if filters.get("branch"):
		conditions.append("so.branch = %(branch)s")
		params["branch"] = filters.get("branch")
	
	if filters.get("sales_person"):
		conditions.append("so.name IN (SELECT parent FROM `tabSales Team` WHERE sales_person = %(sales_person)s)")
		params["sales_person"] = filters.get("sales_person")
	
	# Get mode of payment from Payment Entry and total paid per Sales Order
	data = frappe.db.sql("""
		SELECT
			so.name,
			so.po_no as reference_no,
			so.customer,
			soi.item_code,
			so.discount_amount as discount,
			(SELECT GROUP_CONCAT(DISTINCT pe.mode_of_payment SEPARATOR ', ')
			 FROM `tabPayment Entry Reference` per
			 INNER JOIN `tabPayment Entry` pe ON pe.name = per.parent
			 WHERE per.reference_name = so.name
			 AND per.reference_doctype = 'Sales Order'
			 AND pe.docstatus = 1) as mode_of_payment,
			soi.qty as total_qty,
			(SELECT SUM(IFNULL(per.allocated_amount, 0))
			 FROM `tabPayment Entry Reference` per
			 INNER JOIN `tabPayment Entry` pe ON pe.name = per.parent
			 WHERE per.reference_name = so.name
			 AND per.reference_doctype = 'Sales Order'
			 AND pe.docstatus = 1) as total_paid
		FROM
			`tabSales Order` so
		INNER JOIN
			`tabSales Order Item` soi ON soi.parent = so.name
		WHERE
			{conditions}
		ORDER BY
			so.name, soi.idx
	""".format(conditions=" AND ".join(conditions)), params, as_dict=True)
	
	return data


def get_sales_invoice_columns():
	return [
		{
			"fieldname": "name",
			"label": _("Name"),
			"fieldtype": "Link",
			"options": "Sales Invoice",
			"width": 120
		},
		{
			"fieldname": "invoice_no",
			"label": _("Invoice No"),
			"fieldtype": "Data",
			"width": 120
		},
		{
			"fieldname": "posting_date",
			"label": _("Date"),
			"fieldtype": "Date",
			"width": 100
		},
		{
			"fieldname": "customer",
			"label": _("Customer"),
			"fieldtype": "Link",
			"options": "Customer",
			"width": 150
		},
		{
			"fieldname": "total",
			"label": _("Total"),
			"fieldtype": "Currency",
			"width": 120
		},
		{
			"fieldname": "discount_amount",
			"label": _("Discount"),
			"fieldtype": "Currency",
			"width": 100
		},
		{
			"fieldname": "grand_total",
			"label": _("Grand Total"),
			"fieldtype": "Currency",
			"width": 120
		},
		{
			"fieldname": "paid_amount",
			"label": _("Paid Amount"),
			"fieldtype": "Currency",
			"width": 120
		},
		{
			"fieldname": "outstanding_amount",
			"label": _("Outstanding"),
			"fieldtype": "Currency",
			"width": 120
		},
		{
			"fieldname": "status",
			"label": _("Payment Status"),
			"fieldtype": "Data",
			"width": 120
		},
		{
			"fieldname": "sales_person",
			"label": _("Sales Person"),
			"fieldtype": "Link",
			"options": "Sales Person",
			"width": 120
		}
	]


def get_sales_invoice_data(filters):
	conditions = []
	params = {
		"company": filters.get("company"),
		"from_date": filters.get("from_date"),
		"to_date": filters.get("to_date")
	}
	
	conditions.append("si.company = %(company)s")
	conditions.append("DATE(si.posting_date) BETWEEN %(from_date)s AND %(to_date)s")
	conditions.append("si.docstatus = 1")
	
	if filters.get("branch"):
		conditions.append("si.branch = %(branch)s")
		params["branch"] = filters.get("branch")
	
	if filters.get("sales_person"):
		conditions.append("si.name IN (SELECT parent FROM `tabSales Team` WHERE sales_person = %(sales_person)s)")
		params["sales_person"] = filters.get("sales_person")
	
	data = frappe.db.sql("""
		SELECT
			si.name,
			si.name as invoice_no,
			si.posting_date,
			si.customer,
			si.total,
			si.discount_amount,
			si.grand_total,
			si.paid_amount,
			si.outstanding_amount,
			si.status,
			(SELECT GROUP_CONCAT(DISTINCT sales_person SEPARATOR ', ')
			 FROM `tabSales Team`
			 WHERE parent = si.name AND parenttype = 'Sales Invoice'
			 LIMIT 1) as sales_person
		FROM
			`tabSales Invoice` si
		WHERE
			{conditions}
		ORDER BY
			si.posting_date DESC, si.name
	""".format(conditions=" AND ".join(conditions)), params, as_dict=True)
	
	return data


def get_purchase_invoice_columns():
	return [
		{
			"fieldname": "name",
			"label": _("Name"),
			"fieldtype": "Link",
			"options": "Purchase Invoice",
			"width": 120
		},
		{
			"fieldname": "invoice_serial_no",
			"label": _("Invoice Serial No"),
			"fieldtype": "Data",
			"width": 120
		},
		{
			"fieldname": "posting_date",
			"label": _("Date"),
			"fieldtype": "Date",
			"width": 100
		},
		{
			"fieldname": "supplier",
			"label": _("Supplier"),
			"fieldtype": "Link",
			"options": "Supplier",
			"width": 150
		},
		{
			"fieldname": "grand_total",
			"label": _("Grand Total"),
			"fieldtype": "Currency",
			"width": 120
		},
		{
			"fieldname": "paid_amount",
			"label": _("Paid Amount"),
			"fieldtype": "Currency",
			"width": 120
		},
		{
			"fieldname": "outstanding_amount",
			"label": _("Outstanding Amount"),
			"fieldtype": "Currency",
			"width": 120
		}
	]


def get_purchase_invoice_data(filters):
	conditions = []
	params = {
		"company": filters.get("company"),
		"from_date": filters.get("from_date"),
		"to_date": filters.get("to_date")
	}
	
	conditions.append("pi.company = %(company)s")
	conditions.append("DATE(pi.posting_date) BETWEEN %(from_date)s AND %(to_date)s")
	conditions.append("pi.docstatus = 1")
	
	if filters.get("branch"):
		conditions.append("pi.branch = %(branch)s")
		params["branch"] = filters.get("branch")
	
	data = frappe.db.sql("""
		SELECT
			pi.name,
			'' as invoice_serial_no,
			pi.posting_date,
			pi.supplier,
			pi.grand_total,
			pi.paid_amount,
			pi.outstanding_amount
		FROM
			`tabPurchase Invoice` pi
		WHERE
			{conditions}
		ORDER BY
			pi.posting_date DESC, pi.name
	""".format(conditions=" AND ".join(conditions)), params, as_dict=True)
	
	return data
