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
				fieldtype: 'Column Break'
			},
			{
				label: __('Posting Date'),
				fieldname: 'posting_date',
				fieldtype: 'Date',
				default: frm.doc.posting_date || frappe.datetime.get_today()
			},
			{
				fieldtype: 'Column Break'
			},
			{
				label: __('Due Date'),
				fieldname: 'due_date',
				fieldtype: 'Date',
				default: frm.doc.due_date || ''
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
				get_query: function() {
					return {
						filters: {
							custom_company: frm.doc.company || ''
						}
					};
				}
			},
			{
				fieldtype: 'Section Break',
				label: __('Warehouse & Pricing')
			},
			{
				label: __('Source Warehouse'),
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
			
			// Validate mandatory fields before saving
			let validation_errors = [];
			
			// Check mandatory accounting dimensions (only if company is set)
			if (frm.doc.company) {
				frappe.call({
					method: 'nextlayer.next_layer.api.invoice_utils.check_mandatory_accounting_dimensions',
					args: {
						company: frm.doc.company
					},
					async: false,
					callback: function(response) {
						if (response && response.message) {
							let mandatory = response.message;
						
						// Check Branch
						if (mandatory.branch && !values.branch) {
							validation_errors.push(__('Branch is mandatory for this company'));
						}
						
						// Check Company Group
						if (mandatory.company_group && !values.company_group) {
							validation_errors.push(__('Company Group is mandatory for this company'));
						}
						
						// Check Marka
						if (mandatory.marka && !values.marka) {
							validation_errors.push(__('Marka is mandatory for this company'));
						}
					}
				}
				});
			}
			
			// Check Source Warehouse (only mandatory if Update Stock is enabled)
			if (frm.doc.update_stock == 1 && !values.set_warehouse) {
				validation_errors.push(__('Source Warehouse is mandatory when Update Stock is enabled'));
			}
			
			// If there are validation errors, show them and don't save
			if (validation_errors.length > 0) {
				frappe.msgprint({
					title: __('Validation Error'),
					message: validation_errors.join('<br>'),
					indicator: 'red'
				});
				return;
			}
			
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
			if (values.posting_date !== undefined) {
				frm.set_value('posting_date', values.posting_date);
			}
			if (values.due_date !== undefined) {
				frm.set_value('due_date', values.due_date);
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
									let company_customer_set = false;  // Flag to ensure company/customer is set only once
									
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
													
													// Always autofill company and customer (regardless of parent_only, only once)
													if (!company_customer_set && response.message.company && response.message.customer) {
														frm.set_value('company', response.message.company);
														frm.set_value('customer', response.message.customer);
														company_customer_set = true;
													}
													
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
												
												// When all requests are complete, show settings modal and refresh
												if (completed_requests === total_requests) {
													show_invoice_settings_modal(frm, 'Sales Invoice');
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
