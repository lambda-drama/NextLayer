// Function to show invoice settings modal
function show_invoice_settings_modal(frm, doctype) {
	let price_list_field = doctype === 'Sales Invoice' ? 'selling_price_list' : 'buying_price_list';
	
	let settings_dialog = new frappe.ui.Dialog({
		title: __('Invoice Settings'),
		fields: [
			{
				label: __('Invoice Number'),
				fieldname: 'custom_invoice_no',
				fieldtype: 'Data',
				default: frm.doc.custom_invoice_no || ''
			},
			{
				fieldtype: 'Section Break',
				label: __('Accounting Dimensions')
			},
			{
				label: __('Marka'),
				fieldname: 'marka',
				fieldtype: 'Link',
				options: 'Marka',
				default: frm.doc.marka || ''
			},
			{
				fieldtype: 'Column Break'
			},
			{
				label: __('Company Group'),
				fieldname: 'company_group',
				fieldtype: 'Link',
				options: 'Company Group',
				default: frm.doc.company_group || ''
			},
			{
				fieldtype: 'Column Break'
			},
			{
				label: __('Branch'),
				fieldname: 'branch',
				fieldtype: 'Link',
				options: 'Branch',
				default: frm.doc.branch || '',
				reqd: 1
			},
			{
				fieldtype: 'Section Break',
				label: __('Warehouse & Pricing')
			},
			{
				label: __('Set Accepted Warehouse'),
				fieldname: 'set_warehouse',
				fieldtype: 'Link',
				options: 'Warehouse',
				default: frm.doc.set_warehouse || '',
				get_query: function() {
					return {
						filters: {
							company: frm.doc.company
						}
					};
				}
			},
			{
				fieldtype: 'Column Break'
			},
			{
				label: __('Price List'),
				fieldname: 'price_list',
				fieldtype: 'Link',
				options: 'Price List',
				default: frm.doc[price_list_field] || '',
				get_query: function() {
					return {
						filters: {
							buying: doctype === 'Purchase Invoice' ? 1 : 0,
							selling: doctype === 'Sales Invoice' ? 1 : 0
						}
					};
				}
			}
		],
		primary_action_label: __('Save'),
		primary_action: function() {
			// Get values from dialog
			let values = settings_dialog.get_values();
			
			// Update form fields
			if (values.custom_invoice_no !== undefined) {
				frm.set_value('custom_invoice_no', values.custom_invoice_no);
			}
			if (values.marka !== undefined) {
				frm.set_value('marka', values.marka);
			}
			if (values.company_group !== undefined) {
				frm.set_value('company_group', values.company_group);
			}
			if (values.branch !== undefined) {
				frm.set_value('branch', values.branch);
			}
			if (values.set_warehouse !== undefined) {
				frm.set_value('set_warehouse', values.set_warehouse);
			}
			if (values.price_list !== undefined) {
				frm.set_value(price_list_field, values.price_list);
			}
			
			// Close dialog
			settings_dialog.hide();
			
			// Refresh and save
			frm.refresh();
			frm.save();
		}
	});
	
	settings_dialog.show();
}

frappe.ui.form.on("Purchase Invoice", {
	refresh: function(frm) {
		if (frm.doc.docstatus == 0) {
			// Add a custom button to open dialog for Parent Sales Invoice
			frm.add_custom_button(__('Parent Sales Invoice'), function() {
				// Create custom dialog with parent only checkbox
				let parent_only = false;
				let dialog = new frappe.ui.Dialog({
					title: __('Select Sales Invoice'),
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
							doctype: "Sales Invoice",
							target: frm,
							setters: {
								status: ''
							},
							add_filters_group: 1,
							date_field: "posting_date",
							get_query() {
								return {
									filters: { docstatus: ['!=', 2] }  // Exclude cancelled Sales Invoices
								};
							},
							action(selections) {
								// Check if selections exist and is not empty
								if (selections && selections.length > 0) {
									// Extract the first Sales Invoice name from selections
									var firstSalesInvoice = selections[0];

									// Call server-side method to fetch items from the selected Sales Invoice
									frappe.call({
										method: 'nextlayer.next_layer.api.invoice_utils.get_items_from_selected_sal_invoice',
										args: {
											sales_invoice: firstSalesInvoice,
											company: frm.doc.company,
											parent_only: parent_only
										},
										callback: function(response) {
											// Check if the response contains a server error message
											if (response._server_messages) {
												let server_messages = JSON.parse(response._server_messages);
												frappe.msgprint({
													title: __('Message'),
													indicator: 'red',
													message: server_messages.join('<br>')
												});
												return;
											}

											// Clear the items table
											frappe.model.clear_table(frm.doc, 'items');
											if (response && response.message) {
												var purchase_invoice_items = response.message.purchase_invoice_items || [];
												var shipping_details = response.message.shipping_details || {};

												// If parent_only is True, autofill company and supplier
												if (parent_only && response.message.company && response.message.supplier) {
													frm.set_value('company', response.message.company);
													frm.set_value('supplier', response.message.supplier);
												}

												if (purchase_invoice_items.length > 0) {
													// Items fetched successfully, iterate over the items
													purchase_invoice_items.forEach(function(item) {
														// Add each item to the Purchase Invoice child table (items)
														var new_item = frm.add_child('items');
														
														new_item.item_code = item.item_code;
														new_item.item_name = item.item_name;
														new_item.qty = item.qty;
														new_item.rate = item.rate;
														new_item.amount = item.amount;
														new_item.custom_containers = item.custom_containers;
														new_item.custom_cartons = item.custom_cartons;
														new_item.uom = item.uom;
														new_item.stock_uom = item.stock_uom;
														new_item.stock_qty = item.stock_qty;
														new_item.conversion_factor = 1.00;
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
													frm.set_value('custom_is_export_sale', shipping_details.is_export_sale);
													frm.set_value('custom_invoice_no', shipping_details.invoice_no);
													frm.set_value('custom_container_no', shipping_details.container_no || '');
													frm.set_value('custom_bill_of_landing', shipping_details.bill_of_landing || '');
													frm.set_value('custom_port_of_loading', shipping_details.port_of_loading || '');
													frm.set_value('custom_port_of_discharge', shipping_details.port_of_discharge || '');
													frm.set_value('custom_destination', shipping_details.destination || '');
													frm.set_value('custom_bil', shipping_details.bil);
													frm.set_value('branch', shipping_details.branch);
													frm.set_value('marka', shipping_details.marka);
													frm.set_value('custom_estimated_date_of_arrival', shipping_details.estimated_date_of_arrival);
													frm.set_value('custom_estimated_date_of_departure', shipping_details.estimated_date_of_departure);
													
													// Show modal for additional settings
													show_invoice_settings_modal(frm, 'Purchase Invoice');
												} else {
													frappe.msgprint("No items found in the selected Sales Invoice");
												}
											} else {
												frappe.msgprint("Failed to fetch items");
											}
										}
									});
								} else {
									frappe.msgprint("No Sales Invoices selected");
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

