// Copyright (c) 2026, jr@gmail.com and contributors
// For license information, please see license.txt

// frappe.ui.form.on("Travel Expense", {
// 	refresh(frm) {

// 	},
// });

// Custom Script for Travel Expense doctype
// File: travel_expense.js

frappe.ui.form.on("Travel Expense", {
	// This runs when form is loaded
	onload: function(frm) {
		// Only show button for Admin users (change as needed)
		if (frappe.user_roles.includes("Administrator")) {
			// Add button to form toolbar
			frm.add_custom_button("Migrate Traveler Names", function() {
				// Confirm before running migration
				frappe.confirm(
					"This will copy traveler_name (Link field) to traveller_name (Table MultiSelect) for ALL Travel Expenses. Continue?",
					function() {
						// Call server-side function
						frappe.call({
							method: "nextlayer.next_layer.doctype.travel_expense.travel_expense.migrate_traveler_names",
							callback: function(r) {
								if (r.message) {
									frappe.msgprint(r.message);
									// Refresh the form
									frm.reload_doc();
								}
							},
							error: function(r) {
								frappe.msgprint("Migration failed. Check error logs.");
							}
						});
					}
				);
			}, "Tools");
		}
	}
});