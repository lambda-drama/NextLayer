// Function to show invoice settings modal
function show_invoice_settings_modal(frm, doctype) {
	let price_list_field = doctype === 'Sales Invoice' ? 'selling_price_list' : 'buying_price_list';
	let should_submit = false;

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
				default: frm.doc.due_date || frappe.datetime.get_today()
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
							company: frm.doc.company,
							is_group: 0
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
			},
			{
				fieldtype: 'Section Break',
				label: __('Stock Settings')
			},
			{
				label: __('Update Stock'),
				fieldname: 'update_stock',
				fieldtype: 'Check',
				default: 1
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

			// Check if invoice number already exists (only if invoice number is provided)
			if (values.custom_invoice_no) {
				frappe.call({
					method: 'nextlayer.next_layer.api.invoice_utils.check_invoice_number_exists',
					args: {
						invoice_number: values.custom_invoice_no,
						doctype: 'Sales Invoice',
						current_docname: frm.doc.name
					},
					async: false,
					callback: function(response) {
						if (response && response.message && response.message.exists) {
							validation_errors.push(__('Sales Invoice {0} already exists', [values.custom_invoice_no]));
						}
					}
				});
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
			if (values.update_stock !== undefined) {
				frm.set_value('update_stock', values.update_stock);
			}

			// Close dialog
			settings_dialog.hide();

			// Refresh and save
			frm.refresh();

			console.log('Primary action clicked, should_submit value:', should_submit);
			console.log('Checkbox checked state:', settings_dialog.$wrapper.find('#allow_submit_checkbox').is(':checked'));

			if (should_submit) {
				console.log('Attempting to save and submit...');
				// First save, then submit using frm.save('Submit')
				frm.save().then(() => {
					console.log('Save completed, now submitting...');
					frm.save('Submit').then(() => {
						console.log('Submit completed successfully');
					}).catch((err) => {
						console.log('Submit failed:', err);
					});
				}).catch((err) => {
					console.log('Save failed:', err);
				});
			} else {
				console.log('Only saving (no submit)...');
				// Just save
				frm.save();
			}
		}
	});

	// Add custom footer with checkbox on the left
	settings_dialog.$wrapper.find('.modal-footer').css({
		'display': 'flex',
		'justify-content': 'space-between',
		'align-items': 'center'
	});

	// Create checkbox container and prepend to footer
	let checkbox_html = `
		<div class="allow-submit-container" style="display: flex; align-items: center; gap: 8px;">
			<input type="checkbox" id="allow_submit_checkbox" style="width: 16px; height: 16px; cursor: pointer;">
			<label for="allow_submit_checkbox" style="margin: 0; cursor: pointer; font-weight: normal;">${__('Allow Submit')}</label>
		</div>
	`;
	settings_dialog.$wrapper.find('.modal-footer').prepend(checkbox_html);

	// Handle checkbox change to toggle button text
	settings_dialog.$wrapper.find('#allow_submit_checkbox').on('change', function() {
		should_submit = $(this).is(':checked');
		console.log('Checkbox changed, should_submit:', should_submit);
		let btn_text = should_submit ? __('Save & Submit') : __('Save');
		settings_dialog.$wrapper.find('.btn-primary').text(btn_text);
		console.log('Button text changed to:', btn_text);
	});

	settings_dialog.show();
}

// Function to show WhatsApp send modal
function show_whatsapp_send_modal(frm) {
	// Get customer phone number
	let customer_mobile = '';
	let default_template = null;
	
	// Fetch customer details and default template
	frappe.call({
		method: 'frappe.client.get',
		args: {
			doctype: 'Customer',
			name: frm.doc.customer
		},
		callback: function(r) {
			if (r.message) {
				customer_mobile = r.message.mobile_no || r.message.custom_mobile_no || '';
			}
			
			// Get default template for Sales Invoice
			frappe.call({
				method: 'nextlayer.next_layer.api.whatsapp.get_default_template_for_doctype',
				args: {
					doctype: 'Sales Invoice'
				},
				callback: function(template_r) {
					if (template_r.message) {
						default_template = template_r.message;
					}
					
					// Get all templates for dropdown
					frappe.call({
						method: 'nextlayer.next_layer.api.whatsapp.get_whatsapp_templates',
						callback: function(templates_r) {
							let templates = templates_r.message || [];
							
							// Create modal dialog
							let whatsapp_dialog = new frappe.ui.Dialog({
								title: __('Send Invoice via WhatsApp'),
								fields: [
									{
										label: __('Phone Number'),
										fieldname: 'mobile_no',
										fieldtype: 'Data',
										default: customer_mobile,
										reqd: 1,
										description: __('Enter phone number with country code (e.g., 1234567890)')
									},
									{
										fieldtype: 'Column Break'
									},
									{
										label: __('WhatsApp Template'),
										fieldname: 'template',
										fieldtype: 'Link',
										options: 'WhatsApp Message Templates',
										default: default_template,
										get_query: function() {
											return {
												filters: {
													status: 'Approved'
												}
											};
										},
										description: __('Optional: Select a template. If not selected, a text message will be sent.')
									},
									{
										fieldtype: 'Section Break',
										label: __('Template Parameters'),
										collapsible: 1,
										collapsed: 1,
										depends_on: 'eval:doc.template'
									},
									{
										label: __('Parameter 1 (Customer Name)'),
										fieldname: 'param1',
										fieldtype: 'Data',
										depends_on: 'eval:doc.template',
										default: frm.doc.customer_name || frm.doc.customer,
										read_only: 1,
										description: __('Auto-filled: Customer Name')
									},
									{
										fieldtype: 'Column Break',
										depends_on: 'eval:doc.template'
									},
									{
										label: __('Parameter 2 (Invoice Number)'),
										fieldname: 'param2',
										fieldtype: 'Data',
										depends_on: 'eval:doc.template',
										default: frm.doc.name,
										read_only: 1,
										description: __('Auto-filled: Invoice Number')
									},
									{
										fieldtype: 'Section Break',
										depends_on: 'eval:doc.template'
									},
									{
										label: __('Additional Parameters'),
										fieldname: 'template_parameters',
										fieldtype: 'Small Text',
										depends_on: 'eval:doc.template',
										description: __('Enter additional parameters separated by commas (e.g., param3, param4). Parameters 1 and 2 are auto-filled above.')
									}
								],
								primary_action_label: __('Send'),
								primary_action: function() {
									let values = whatsapp_dialog.get_values();
									
									if (!values.mobile_no) {
										frappe.msgprint(__('Please enter a phone number'));
										return;
									}
									
									// Build template parameters array
									// Parameter 1: Customer Name, Parameter 2: Invoice Number
									let template_parameters = [];
									if (values.template) {
										// Always include customer name as first parameter
										template_parameters.push(frm.doc.customer_name || frm.doc.customer || '');
										// Always include invoice number as second parameter
										template_parameters.push(frm.doc.name || '');
										
										// Add additional parameters if provided
										if (values.template_parameters) {
											let additional_params = values.template_parameters.split(',').map(p => p.trim()).filter(p => p);
											template_parameters = template_parameters.concat(additional_params);
										}
									} else {
										template_parameters = null;
									}
									
									// Show loading indicator
									frappe.show_progress(__('Sending'), 50, __('Sending invoice via WhatsApp...'));
									
									// Send WhatsApp message
									frappe.call({
										method: 'nextlayer.next_layer.api.whatsapp.send_invoice_via_whatsapp_with_template',
										args: {
											invoice_name: frm.doc.name,
											mobile_no: values.mobile_no,
											template_name: values.template || null,
											template_parameters: template_parameters
										},
										callback: function(send_r) {
											frappe.hide_progress();
											
											if (send_r.message && send_r.message.status === 'success') {
												frappe.show_alert({
													message: __('Invoice sent successfully via WhatsApp'),
													indicator: 'green'
												}, 5);
												whatsapp_dialog.hide();
												frm.reload_doc();
											} else {
												frappe.msgprint({
													title: __('Error'),
													message: send_r.message && send_r.message.error 
														? send_r.message.error 
														: __('Failed to send WhatsApp message'),
													indicator: 'red'
												});
											}
										},
										error: function(error_r) {
											frappe.hide_progress();
											frappe.msgprint({
												title: __('Error'),
												message: error_r.message || __('Failed to send WhatsApp message'),
												indicator: 'red'
											});
										}
									});
								}
							});
							
							whatsapp_dialog.show();
						}
					});
				}
			});
		}
	});
}

frappe.ui.form.on("Sales Invoice", {
	validate: function(frm) {
		if (frm.doc.customer && (!frm.doc.custom_invoice_no || !frm.doc.custom_invoice_no.startsWith("GLI-"))) {
			frappe.call({
				method: "nextlayer.next_layer.controllers.sales_invoice.generate_gl_invoice_number",
				args: {
					customer: frm.doc.customer,
					posting_date: frm.doc.posting_date || null
				},
				callback: function(r) {
					if (r.message && r.message.success && r.message.invoice_number) {
						frm.set_value("custom_invoice_no", r.message.invoice_number);
						frm.refresh_field("custom_invoice_no");
					}
				},
				error: function(r) {
					// Silently fail - don't show error if generation fails
				}
			});
		}
		// Auto-fetch advances from Sales Order if invoice is created from an order
		// This runs before Python validate, so advances are pulled early
		if (frm.doc.docstatus == 0) {
			// Check if Sales Invoice is created from a Sales Order
			let sales_order = frm.doc.sales_order;
			if (!sales_order && frm.doc.items && frm.doc.items.length > 0) {
				for (let item of frm.doc.items) {
					if (item.sales_order) {
						sales_order = item.sales_order;
						break;
					}
				}
			}

			// If Sales Order exists and no advances are present, fetch them automatically
			if (sales_order && frm.doc.customer && (!frm.doc.advances || frm.doc.advances.length === 0)) {
				frappe.call({
					method: "nextlayer.next_layer.controllers.sales_invoice.fetch_advances_from_sales_order_api",
					args: {
						sales_order: sales_order,
						customer: frm.doc.customer,
						// sales_invoice_name: frm.doc.name || null
					},
					async: false,  // Make it synchronous so it completes before validation
					callback: function(r) {
						if (r.message && r.message.success && r.message.advances && r.message.advances.length > 0) {
							// Clear existing advances
							frm.clear_table("advances");

							// Add advances directly to the form
							r.message.advances.forEach(function(advance) {
								let advance_row = frm.add_child("advances");
								advance_row.allocated_amount = advance.allocated_amount;
								advance_row.advance_amount = advance.advance_amount;
								advance_row.advance_account = advance.advance_account;
								advance_row.difference_posting_date = advance.difference_posting_date;
								advance_row.reference_type = advance.reference_type;
								advance_row.reference_name = advance.reference_name;
								advance_row.reference_row = advance.reference_row;
								advance_row.remarks = advance.remarks;
							});

							// Refresh advances table
							frm.refresh_field("advances");
						}
					},
					error: function(r) {
						// Silently fail - don't show error if no advances found
					}
				});
			}
		}
	},
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

													// Set set_posting_time to ticked by default (only once)
													if (completed_requests === 1) {
														frm.set_value('set_posting_time', 1);
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
													if (shipping_details.shipping_mode) {
														frm.set_value('custom_shipping_mode', shipping_details.shipping_mode);
													}
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
		
		// Add WhatsApp button group (only for submitted invoices)
		if (frm.doc.docstatus === 1 && frm.doc.customer) {
			frm.add_custom_button(__('Send'), function() {
				show_whatsapp_send_modal(frm);
			}, __('WhatsApp'));
		}
	}
});
