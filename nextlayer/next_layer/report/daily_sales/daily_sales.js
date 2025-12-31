// Copyright (c) 2025, jr@gmail.com and contributors
// For license information, please see license.txt

frappe.query_reports["Daily Sales"] = {
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
			"fieldname": "entry_type",
			"label": __("Entry Type"),
			"fieldtype": "Select",
			"options": [
				"Receipt entry",
				"Sales Invoice"
			],
			"default": "Sales Invoice",
			"reqd": 1
		},
		{
			"fieldname": "date",
			"label": __("Date"),
			"fieldtype": "Date",
			"default": frappe.datetime.get_today(),
			"reqd": 1
		}
	]
};
