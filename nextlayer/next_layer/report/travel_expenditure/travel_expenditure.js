// Copyright (c) 2026, jr@gmail.com and contributors
// For license information, please see license.txt

frappe.query_reports["Travel Expenditure"] = {
	filters: [
		{
			fieldname: "company",
			label: __("Company"),
			fieldtype: "Link",
			options: "Company",
			default: frappe.defaults.get_user_default("Company"),
		},
		{
			fieldname: "company_group",
			label: __("Company Group"),
			fieldtype: "Link",
			options: "Company Group",
		},
		{
			fieldname: "from_date",
			label: __("From Date"),
			fieldtype: "Date",
			default: frappe.datetime.add_months(frappe.datetime.get_today(), -1),
			width: "80px",
		},
		{
			fieldname: "to_date",
			label: __("To Date"),
			fieldtype: "Date",
			default: frappe.datetime.get_today(),
			width: "80px",
		},
		{
			fieldname: "booked_by",
			label: __("Booked By"),
			fieldtype: "Link",
			options: "Member",
		},
		{
			fieldname: "traveller_name",
			label: __("Traveller Name"),
			fieldtype: "Link",
			options: "Member",
		},
		{
			fieldname: "travel_type",
			label: __("Type of Travel"),
			fieldtype: "Select",
			options: ["", "One Way", "Return"],
		},
		{
			fieldname: "group_by",
			label: __("Group By"),
			fieldtype: "Select",
			options: ["", "Traveller Name", "Hotel"],
		},
	],
};
