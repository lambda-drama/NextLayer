// Copyright (c) 2025, jr@gmail.com and contributors
// For license information, please see license.txt

frappe.query_reports["Day Activity"] = {
	"filters": [
		{
			"fieldname": "company",
			"label": __("Company"),
			"fieldtype": "Link",
			"options": "Company",
			"default": frappe.defaults.get_user_default("Company"),
			"reqd": 1
		},
		{
			"fieldname": "doctype",
			"label": __("DocType"),
			"fieldtype": "Select",
			"options": [
				"Sales Order",
				"Sales Invoice",
				"Payment Entry",
				"Salary Advance",
				"Purchase Invoice",
				"Expense Claim"
			],
			"default": "Sales Invoice",
			"reqd": 1
		},
		{
			"fieldname": "from_date",
			"label": __("Date From"),
			"fieldtype": "Date",
			"default": frappe.datetime.get_today(),
			"reqd": 1
		},
		{
			"fieldname": "to_date",
			"label": __("Date To"),
			"fieldtype": "Date",
			"default": frappe.datetime.get_today(),
			"reqd": 1
		},
		{
			"fieldname": "branch",
			"label": __("Branch"),
			"fieldtype": "Link",
			"options": "Branch"
		},
		{
			"fieldname": "sales_person",
			"label": __("Sales Person"),
			"fieldtype": "Link",
			"options": "Sales Person"
		}
	]
};
