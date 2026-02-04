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
			fieldname: "currency",
			label: __("Currency"),
			fieldtype: "Link",
			options: "Currency",
			default: "USD",
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
			options: ["", "Traveller Name", "Expense Type", "Travel Group"],
			on_change: function () {
				// Enable tree/expandable rows when Group By is set (like P&L)
				var report = frappe.query_report;
				var group_by = report.get_filter_value("group_by");
				if (group_by) {
					report.report_settings.tree = true;
					report.report_settings.name_field = "account";
					report.report_settings.parent_field = "parent_account";
					report.report_settings.initial_depth = 0;
				} else {
					report.report_settings.tree = false;
					report.report_settings.name_field = null;
					report.report_settings.parent_field = null;
					report.report_settings.initial_depth = null;
				}
				report.refresh();
			},
		},
		{
			fieldname: "travel_group_breakdown_by",
			label: __("Breakdown By"),
			fieldtype: "Select",
			options: ["Traveller Name", "Expense Type"],
			default: "Traveller Name",
			depends_on: "eval:doc.group_by == 'Travel Group'",
			description: __("When Group By is Travel Group: show traveller distribution or expense type distribution when expanded"),
		},
		{
			fieldname: "show_fully_cancelled_expenses",
			label: __("Show Fully Cancelled Expenses"),
			fieldtype: "Check",
			description: __("Include travel expenses that have been fully cancelled (reverse journal created)"),
		},
	],
	onload: function (report) {
		// Set tree config on initial load based on group_by
		var group_by = report.get_filter_value("group_by");
		if (group_by) {
			report.report_settings.tree = true;
			report.report_settings.name_field = "account";
			report.report_settings.parent_field = "parent_account";
			report.report_settings.initial_depth = 0;
		} else {
			report.report_settings.tree = false;
		}
	},
};
