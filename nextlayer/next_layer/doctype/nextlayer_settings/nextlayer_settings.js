// Copyright (c) 2026, jr@gmail.com and contributors
// For license information, please see license.txt

frappe.ui.form.on("NextLayer Settings", {
	onload(frm) {
		// Filter Account by row's company (same approach as Pick List barcode set_query in inventory_management_extension)
		frm.set_query("account", "travel_expense_accounts", (frm, cdt, cdn) => {
			const row = locals[cdt][cdn];
			if (!row.company) return {};
			return {
				filters: { company: row.company }
			};
		});
		frm.refresh_field("travel_expense_accounts");
		frm.refresh();
	}
});

frappe.ui.form.on("Account Travel Expense", {
	company(frm, cdt, cdn) {
		var row = locals[cdt][cdn];
		row.account = null;
		frm.refresh_field("travel_expense_accounts");
	}
});
