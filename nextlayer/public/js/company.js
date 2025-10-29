// Copyright (c) 2025, jr@gmail.com and contributors
// For license information, please see license.txt

frappe.ui.form.on("Company", {
	refresh(frm) {
		// Add Generate EAN-13 Barcodes button
		frm.add_custom_button(__("Generate EAN-13 Barcodes"), function() {
			generate_ean_barcodes(frm);
		}, __("Actions"));

		// Add Generate Short Barcodes (6/8) button
		frm.add_custom_button(__("Generate Short Barcodes (6/8)"), function() {
			open_short_barcode_dialog(frm);
		}, __("Actions"));
	}
});

// Function to generate EAN barcodes for all items
function generate_ean_barcodes(frm) {
	frappe.confirm(
		__("This will generate EAN barcodes for all items and add them to the Item Barcode child table. Continue?"),
		function() {
			// Show progress dialog
			let progress_dialog = new frappe.ui.Dialog({
				title: __("Generating EAN Barcodes"),
				fields: [
					{
						fieldtype: "HTML",
						fieldname: "progress_html",
						options: `
							<div class="progress-container">
								<div class="progress-bar">
									<div class="progress-fill" id="progress-fill"></div>
								</div>
								<div class="progress-text" id="progress-text">Starting...</div>
							</div>
							<style>
								.progress-container {
									margin: 20px 0;
								}
								.progress-bar {
									width: 100%;
									height: 20px;
									background-color: #f0f0f0;
									border-radius: 10px;
									overflow: hidden;
									margin-bottom: 10px;
								}
								.progress-fill {
									height: 100%;
									background-color: #1568C6;
									width: 0%;
									transition: width 0.3s ease;
								}
								.progress-text {
									text-align: center;
									font-weight: bold;
								}
							</style>
						`
					}
				],
				primary_action_label: __("Close"),
				primary_action: function() {
					progress_dialog.hide();
				}
			});

			progress_dialog.show();

			// Call server method to generate barcodes
			frappe.call({
				method: "nextlayer.next_layer.controllers.generate_barcode.generate_ean_barcodes_for_items",
				args: {
					company: frm.doc.name
				},
				callback: function(r) {
					if (r.message) {
						let result = r.message;

						// Update progress bar
						let progressFill = document.getElementById('progress-fill');
						let progressText = document.getElementById('progress-text');

						if (progressFill && progressText) {
							progressFill.style.width = '100%';
							progressText.textContent = `Completed! Generated ${result.generated_count} barcodes`;
						}

						// Show success message
						frappe.msgprint({
							title: __("Success"),
							message: __("Generated {0} EAN barcodes successfully!", [result.generated_count]),
							indicator: 'green'
						});
					} else {
						frappe.msgprint({
							title: __("Error"),
							message: __("Failed to generate barcodes. Please try again."),
							indicator: 'red'
						});
					}
				},
				error: function(err) {
					frappe.msgprint({
						title: __("Error"),
						message: __("An error occurred while generating barcodes: {0}", [err.message || "Unknown error"]),
						indicator: 'red'
					});
				}
			});
		}
	);
}

// Dialog to choose 6 or 8 digit short barcode generation
function open_short_barcode_dialog(frm) {
	let d = new frappe.ui.Dialog({
		title: __("Generate Short Barcodes"),
		fields: [
			{ fieldtype: "HTML", fieldname: "help", options: __("Choose the length for numeric Code128 barcodes.") },
			{ fieldtype: "Select", fieldname: "length", label: __("Length"), options: "6\n8", default: "6" },
		],
		primary_action_label: __("Generate"),
		primary_action: function() {
			let values = d.get_values();
			let length = cint(values.length);
			d.hide();

			frappe.call({
				method: "nextlayer.next_layer.controllers.generate_barcode.generate_short_barcodes_for_items",
				args: { company: frm.doc.name, length },
				callback: function(r) {
					if (r.message) {
						const res = r.message;
						frappe.msgprint({
							title: __("Short Barcodes Generated"),
							message: __("Generated {0}, Skipped {1}, Length {2}", [res.generated_count, res.skipped_count, res.length]),
							indicator: 'green'
						});
					} else {
						frappe.msgprint({
							title: __("Error"),
							message: __("Failed to generate short barcodes."),
							indicator: 'red'
						});
					}
				}
			});
		}
	});

	d.show();
}
