// Copyright (c) 2025, jr@gmail.com and contributors
// For license information, please see license.txt

frappe.ui.form.on("Bulk Update Status", {
	refresh(frm) {
		// Add cleanup buttons dynamically
		frm.add_custom_button(__("Cleanup Cancelled Sales Invoices"), function() {
			cleanup_cancelled_documents(frm, "Sales Invoice");
		}, __("Actions"));

		frm.add_custom_button(__("Cleanup Cancelled Purchase Invoices"), function() {
			cleanup_cancelled_documents(frm, "Purchase Invoice");
		}, __("Actions"));

		frm.add_custom_button(__("Cleanup Cancelled Journal Entries"), function() {
			cleanup_cancelled_documents(frm, "Journal Entry");
		}, __("Actions"));

		frm.add_custom_button(__("Cleanup Cancelled Payment Entries"), function() {
			cleanup_cancelled_documents(frm, "Payment Entry");
		}, __("Actions"));

		// Add a separator button for better organization
		frm.add_custom_button(__("Run All Cleanups"), function() {
			run_all_cleanups(frm);
		}, __("Actions"));
	}
});

function cleanup_cancelled_documents(frm, doctype) {
	// Show confirmation dialog
	frappe.confirm(
		`Are you sure you want to cleanup intercompany matches for all cancelled ${doctype}s?`,
		function() {
			// Show loading indicator
			frm.dashboard.set_headline_alert(
				`<div class="alert alert-info">
					<i class="fa fa-spinner fa-spin"></i>
					Processing cancelled ${doctype}s...
				</div>`
			);

			// Call the appropriate API based on doctype
			let api_method = "";
			switch(doctype) {
				case "Sales Invoice":
					api_method = "nextlayer.next_layer.api.general_ledger.bulk_cleanup_cancelled_sales_invoices";
					break;
				case "Purchase Invoice":
					api_method = "nextlayer.next_layer.api.general_ledger.bulk_cleanup_cancelled_purchase_invoices";
					break;
				case "Journal Entry":
					api_method = "nextlayer.next_layer.api.general_ledger.bulk_cleanup_cancelled_journal_entries";
					break;
				case "Payment Entry":
					api_method = "nextlayer.next_layer.api.general_ledger.bulk_cleanup_cancelled_payment_entries";
					break;
			}

			frappe.call({
				method: api_method,
				callback: function(response) {
					// Clear loading indicator
					frm.dashboard.clear_headline();

					if (response.message && response.message.success) {
						// Show success message
						frappe.msgprint({
							title: __("Cleanup Completed"),
							message: __(response.message.message) +
								`<br><br><strong>Summary:</strong><br>
								• Total Found: ${response.message.total_found}<br>
								• Processed: ${response.message.processed}<br>
								• Errors: ${response.message.errors}`,
							indicator: 'green'
						});
					} else {
						// Show error message
						frappe.msgprint({
							title: __("Cleanup Failed"),
							message: response.message ? response.message.message : "Unknown error occurred",
							indicator: 'red'
						});
					}
				},
				error: function(err) {
					// Clear loading indicator
					frm.dashboard.clear_headline();

					// Show error message
					frappe.msgprint({
						title: __("Error"),
						message: "An error occurred while processing the cleanup: " + err.message,
						indicator: 'red'
					});
				}
			});
		},
		__("Yes"),
		__("No")
	);
}

function run_all_cleanups(frm) {
	// Show confirmation dialog
	frappe.confirm(
		"Are you sure you want to cleanup intercompany matches for ALL cancelled documents (Sales Invoices, Purchase Invoices, Journal Entries, and Payment Entries)?",
		function() {
			// Show loading indicator
			frm.dashboard.set_headline_alert(
				`<div class="alert alert-info">
					<i class="fa fa-spinner fa-spin"></i>
					Processing all cancelled documents...
				</div>`
			);

			// Array of all cleanup methods
			const cleanup_methods = [
				"nextlayer.next_layer.api.general_ledger.bulk_cleanup_cancelled_sales_invoices",
				"nextlayer.next_layer.api.general_ledger.bulk_cleanup_cancelled_purchase_invoices",
				"nextlayer.next_layer.api.general_ledger.bulk_cleanup_cancelled_journal_entries",
				"nextlayer.next_layer.api.general_ledger.bulk_cleanup_cancelled_payment_entries"
			];

			const doctype_names = ["Sales Invoice", "Purchase Invoice", "Journal Entry", "Payment Entry"];
			let completed_count = 0;
			let total_found = 0;
			let total_processed = 0;
			let total_errors = 0;
			let results = [];

			// Process each cleanup method
			cleanup_methods.forEach((method, index) => {
				frappe.call({
					method: method,
					callback: function(response) {
						completed_count++;

						if (response.message && response.message.success) {
							total_found += response.message.total_found || 0;
							total_processed += response.message.processed || 0;
							total_errors += response.message.errors || 0;
							results.push(`${doctype_names[index]}: ${response.message.processed || 0} processed`);
						} else {
							total_errors++;
							results.push(`${doctype_names[index]}: Error - ${response.message ? response.message.message : "Unknown error"}`);
						}

						// Check if all methods are completed
						if (completed_count === cleanup_methods.length) {
							// Clear loading indicator
							frm.dashboard.clear_headline();

							// Show comprehensive results
							frappe.msgprint({
								title: __("All Cleanups Completed"),
								message: `<strong>Overall Summary:</strong><br>
									• Total Found: ${total_found}<br>
									• Total Processed: ${total_processed}<br>
									• Total Errors: ${total_errors}<br><br>
									<strong>Details by Document Type:</strong><br>
									${results.join('<br>')}`,
								indicator: total_errors > 0 ? 'orange' : 'green'
							});
						}
					},
					error: function(err) {
						completed_count++;
						total_errors++;
						results.push(`${doctype_names[index]}: API Error - ${err.message}`);

						// Check if all methods are completed
						if (completed_count === cleanup_methods.length) {
							// Clear loading indicator
							frm.dashboard.clear_headline();

							// Show results with errors
							frappe.msgprint({
								title: __("Cleanups Completed with Errors"),
								message: `<strong>Overall Summary:</strong><br>
									• Total Found: ${total_found}<br>
									• Total Processed: ${total_processed}<br>
									• Total Errors: ${total_errors}<br><br>
									<strong>Details by Document Type:</strong><br>
									${results.join('<br>')}`,
								indicator: 'orange'
							});
						}
					}
				});
			});
		},
		__("Yes"),
		__("No")
	);
}
