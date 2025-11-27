frappe.ui.form.on("Sales Invoice", {
	refresh: function(frm) {
		if (frm.doc.docstatus == 0) {
			// Add a custom button to open dialog for Parent Purchase Invoice
			frm.add_custom_button(__('Parent Purchase Invoice'), function() {
				// Create custom dialog with parent only checkbox
				let parent_only = false;
				let dialog = new frappe.ui.Dialog({
					title: __('Select Purchase Invoice'),
					fields: [
						{
							label: __('Parent Items Only'),
							fieldname: 'parent_only',
							fieldtype: 'Check',
							default: 0,
							onchange: function() {
								parent_only = dialog.get_value('parent_only') || false;
							}
						}
					],
					primary_action_label: __('Select'),
					primary_action: function() {
						parent_only = dialog.get_value('parent_only') || false;
						dialog.hide();
						
						// Open MultiSelectDialog after getting parent_only setting
						new frappe.ui.form.MultiSelectDialog({
							doctype: "Purchase Invoice",
							target: frm,
							setters: {
								status: ''
							},
							add_filters_group: 1,
							date_field: "posting_date",
							get_query() {
								return {
									filters: { docstatus: ['!=', 2] }  // Exclude cancelled Purchase Invoices
								}
							},
							action(selections) {
								// Check if selections exist and are not empty
								if (selections && selections.length > 0) {
									console.log(selections)
									
									// Clear the items table before adding new items
									frappe.model.clear_table(frm.doc, "items");
									frm.doc.group_same_items = 0;
									
									// Track completed requests
									let completed_requests = 0;
									let total_requests = selections.length;
									
									// Iterate over each selected Purchase Invoice
									selections.forEach(function(purchase_invoice) {
										// Call server-side method to fetch items from the selected Purchase Invoice
										frappe.call({
											method: 'nextlayer.next_layer.api.invoice_utils.get_items_from_selected_purchase_invoice',
											args: {
												purchase_invoice: purchase_invoice,
												company: frm.doc.company,
												parent_only: parent_only
											},
											callback: function(response) {
												completed_requests++;
												
												if (response && response.message) {
													console.log(response.message)
													// Items fetched successfully, iterate over the items
													response.message.sales_invoice_items.forEach(function(item) {
														// Add each item to the Sales Invoice child table (items)
														var new_item = frm.add_child('items');
														new_item.item_code = item.item_code;
														new_item.item_name = item.item_name;
														new_item.qty = item.qty;
														new_item.rate = item.rate;
														new_item.amount = item.amount;
														new_item.custom_containers = item.custom_containers;
														new_item.custom_cartons = item.custom_cartons;
														new_item.uom = item.uom;
														new_item.stock_uom = item.uom;
														new_item.conversion_factor = 1.00;
														new_item.income_account = item.income_account;
														new_item.expense_account = item.expense_account;
														new_item.custom_purchase_invoice = purchase_invoice;
														new_item.custom_item_identifier = item.custom_item_identifier;
														// Add other item fields as needed
													});
													
													// Update the transit numbers
													response.message.transit_numbers.forEach(function(transit_number) {
														// Add each transit number to the Custom Transit Number child table
														var new_transit = frm.add_child('custom_transit_number');
														new_transit.document_type = transit_number.document_type;
														new_transit.company = transit_number.company;
														new_transit.transit_no = transit_number.transit_no;
													});
													
													// Update form fields with the fetched shipping details
													const shipping_details = response.message.shipping_details;
													frm.set_value('custom_is_export_sale', shipping_details.is_export_sale);
													frm.set_value('custom_invoice_no', shipping_details.invoice_no);
													frm.set_value('custom_container_no', shipping_details.container_no);
													frm.set_value('po_no', shipping_details.invoice_no);
													frm.set_value('custom_bill_of_landing', shipping_details.bill_of_landing);
													frm.set_value('custom_port_of_loading', shipping_details.port_of_loading);
													frm.set_value('custom_port_of_discharge', shipping_details.port_of_discharge);
													frm.set_value('custom_destination', shipping_details.destination);
													frm.set_value('custom_bil', shipping_details.bil);
													frm.set_value('branch', shipping_details.branch);
													frm.set_value('marka', shipping_details.marka);
													frm.set_value('custom_estimated_date_of_arrival', shipping_details.estimated_date_of_arrival);
													frm.set_value('custom_estimated_date_of_departure', shipping_details.estimated_date_of_departure);
												} else {
													frappe.msgprint("Failed to fetch items from " + purchase_invoice);
												}
												
												// When all requests are complete, refresh and save
												if (completed_requests === total_requests) {
													frm.refresh();
													frm.save();
												}
											}
										});
									});
								} else {
									frappe.msgprint("No Purchase Invoices selected");
								}
								cur_dialog.hide();
							}
						});
					}
				});
				dialog.show();
			}, __('Get Items From'));
		}
	}
});
