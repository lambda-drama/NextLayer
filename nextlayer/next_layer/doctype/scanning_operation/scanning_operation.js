// Copyright (c) 2025, jr@gmail.com and contributors
// For license information, please see license.txt

frappe.ui.form.on("Scanning Operation", {
	refresh(frm) {
		// Set focus on barcode field for automatic scanning
		if (frm.doc.scan_barcode && frm.fields_dict.scan_barcode) {
			frm.fields_dict.scan_barcode.set_focus();
		}

		if (frm.doc.docstatus === 1) {
			add_create_buttons(frm);
		}

		setup_automatic_barcode_detection(frm);

		setup_warehouse_filters(frm);
		setup_accounting_dimension_filters(frm);
		
		// Setup verification mode restrictions
		setup_verification_mode(frm);
		
		// Setup decrease button handlers
		setup_decrease_buttons(frm);
	},
	
	items_add(frm, cdt, cdn) {
		// Attach decrease button handler when new row is added
		setup_decrease_button_for_row(frm, cdt, cdn);
	},
	
	items_refresh(frm) {
		// Re-setup decrease button handlers when items table is refreshed
		setup_decrease_buttons(frm);
	},

	company(frm) {
		// Clear warehouse fields when company changes
		frm.set_value("ds_warehouse", "");
		frm.set_value("dt_warehouse", "");

		// Clear accounting dimension fields when company changes
		frm.set_value("cost_center", "");
		frm.set_value("project", "");
		frm.set_value("branch", "");

		// Update warehouse filters
		setup_warehouse_filters(frm);
		setup_accounting_dimension_filters(frm);

		// Setup customer/supplier filters based on company
		// setup_party_filters(frm);
	},

	scan_barcode(frm) {
		if (frm.doc.scan_barcode) {
			process_barcode_scan(frm);
		}
	},

	verified_by(frm) {
		// When verified_by is set, enforce verification mode restrictions
		setup_verification_mode(frm);
	},

	operation(frm) {
		// Clear warehouse fields and party fields when operation changes
		frm.set_value("ds_warehouse", "");
		frm.set_value("dt_warehouse", "");
		// frm.set_value("customer", "");
		// frm.set_value("supplier", "");
	},

	ds_warehouse(frm) {
		// When default source warehouse changes, update all child table warehouses on save
		if (frm.doc.operation === "Loading" && frm.doc.ds_warehouse && frm.doc.items && frm.doc.items.length > 0) {
			frappe.show_alert({
				message: __("Warehouses in items table will be updated to '{0}' on save", [frm.doc.ds_warehouse]),
				indicator: "blue"
			}, 3);
		}
	},

	dt_warehouse(frm) {
		// When default target warehouse changes, update all child table warehouses on save
		if (frm.doc.operation === "Offloading" && frm.doc.dt_warehouse && frm.doc.items && frm.doc.items.length > 0) {
			frappe.show_alert({
				message: __("Warehouses in items table will be updated to '{0}' on save", [frm.doc.dt_warehouse]),
				indicator: "blue"
			}, 3);
		}
	},
	

	before_save(frm) {
		// Auto-fill missing warehouses before submit
		auto_fill_missing_warehouses(frm);
	},

});


// Function to setup automatic barcode detection
function setup_automatic_barcode_detection(frm) {
	// Remove any existing listeners
	$(document).off('keypress.scanning_operation');

	// Add listener for automatic barcode detection
	$(document).on('keypress.scanning_operation', function(e) {
		// Check if we're on the scanning operation form
		if (cur_frm && cur_frm.doctype === "Scanning Operation" && cur_frm.docname === frm.doc.name) {
			// Check if barcode field is focused
			let barcode_field = $('[data-fieldname="scan_barcode"] input');
			if (barcode_field.is(':focus')) {
				// Handle barcode input when Enter is pressed
				if (e.which === 13) { // Enter key pressed
					e.preventDefault();
					let current_value = $(e.target).val();
					if (current_value && current_value.length > 0) {
						frm.set_value("scan_barcode", current_value);
						process_barcode_scan(frm);
					}
				}
			}
		}
	});
}

// Function to add Create buttons group
function add_create_buttons(frm) {
	// Remove existing Create buttons if any
	$('.btn-group[data-label="Create"]').remove();

	if (frm.doc.operation === "Offloading") {
		// For Offloading operation - Purchase Receipt and Purchase Invoice
		frm.add_custom_button(__("Purchase Receipt"), function() {
			create_purchase_receipt(frm);
		}, __("Create"));

		frm.add_custom_button(__("Purchase Invoice"), function() {
			create_purchase_invoice(frm);
		}, __("Create"));

	} else if (frm.doc.operation === "Loading") {
		// For Loading operation - Delivery Note and Sales Invoice
		frm.add_custom_button(__("Delivery Note"), function() {
			create_delivery_note(frm);
		}, __("Create"));

		frm.add_custom_button(__("Sales Invoice"), function() {
			create_sales_invoice(frm);
		}, __("Create"));
	}
}

// Function to create Purchase Receipt
function create_purchase_receipt(frm) {
	if (!frm.doc.items || frm.doc.items.length === 0) {
		frappe.msgprint(__("No items found to create Purchase Receipt"));
		return;
	}

	// Prepare items data for the new document
	let items_data = [];
	frm.doc.items.forEach(function(item) {
		items_data.push({
			item_code: item.item_code,
			item_name: item.item_name,
			qty: item.quantity,
			uom: item.uom,
			stock_uom: item.stock_uom || item.uom,
			warehouse: item.warehouse,
			barcode: item.barcode,
			description: item.description,
			custom_containers: item.uomcontainers,
			custom_cartons: item.uomcartons
		});
	});

	// Navigate to new Purchase Receipt with pre-filled data
	let args = {
		posting_date: frm.doc.date,
		posting_time: frm.doc.posting_time,
		company: frm.doc.company,
		set_warehouse: frm.doc.dt_warehouse,
		custom_scanning_operation: frm.doc.name,
		custom_invoice_no: frm.doc.scanning_name,
		company_group: frm.doc.company_group,
		cost_center: frm.doc.cost_center,
		project: frm.doc.project,
		marka: frm.doc.marka,
		branch: frm.doc.branch,
		custom_container_no: frm.doc.container_no,
		custom_port_of_loading: frm.doc.port_of_loading,
		custom_bill_of_landing: frm.doc.data_ncab,
		custom_bil: frm.doc.bil,
		custom_bill_of_exit: frm.doc.bill_of_exit,
		custom_estimated_date_of_departure: frm.doc.estimated_date_of_departure,
		custom_destination: frm.doc.destination,
		custom_port_of_discharge: frm.doc.port_of_discharge,
		custom_container_quantity: frm.doc.container_quantity,
		custom_shippin_line: frm.doc.shipping_line,
		custom_estimated_date_of_arrival: frm.doc.estimated_date_of_arrival,
		custom_remaining_days: frm.doc.remaining_days,
		custom_actual_arrival_date: frm.doc.actual_arrival_date,
		custom_shipping_status: frm.doc.shipping_status,
		custom_total_cartons: frm.doc.total_cartons,
		custom_total_containers: frm.doc.total_containers
	};

	frappe.route_options = args;
	frappe.new_doc("Purchase Receipt");

	// Wait for the document to load and then add items
	wait_for_document_and_add_items("Purchase Receipt", items_data);
}

// Function to create Purchase Invoice
function create_purchase_invoice(frm) {
	if (!frm.doc.items || frm.doc.items.length === 0) {
		frappe.msgprint(__("No items found to create Purchase Invoice"));
		return;
	}

	// Prepare items data for the new document
	let items_data = [];
	frm.doc.items.forEach(function(item) {
		items_data.push({
			item_code: item.item_code,
			item_name: item.item_name,
			qty: item.quantity,
			uom: item.uom,
			stock_uom: item.stock_uom || item.uom,
			warehouse: item.warehouse,
			barcode: item.barcode,
			description: item.description,
			custom_containers: item.uomcontainers,
			custom_cartons: item.uomcartons
		});
	});

	// Navigate to new Purchase Invoice with pre-filled data
	let args = {
		supplier: frm.doc.supplier,
		posting_date: frm.doc.date,
		posting_time: frm.doc.posting_time,
		company: frm.doc.company,
		set_warehouse: frm.doc.dt_warehouse,
		custom_scanning_operation: frm.doc.name,
		custom_invoice_no: frm.doc.scanning_name,
		company_group: frm.doc.company_group,
		cost_center: frm.doc.cost_center,
		project: frm.doc.project,
		marka: frm.doc.marka,
		branch: frm.doc.branch,
		custom_container_no: frm.doc.container_no,
		custom_port_of_loading: frm.doc.port_of_loading,
		custom_bill_of_landing: frm.doc.data_ncab,
		custom_bil: frm.doc.bil,
		custom_bill_of_exit: frm.doc.bill_of_exit,
		custom_estimated_date_of_departure: frm.doc.estimated_date_of_departure,
		custom_destination: frm.doc.destination,
		custom_port_of_discharge: frm.doc.port_of_discharge,
		custom_container_quantity: frm.doc.container_quantity,
		custom_shippin_line: frm.doc.shipping_line,
		custom_estimated_date_of_arrival: frm.doc.estimated_date_of_arrival,
		custom_remaining_days: frm.doc.remaining_days,
		custom_actual_arrival_date: frm.doc.actual_arrival_date,
		custom_shipping_status: frm.doc.shipping_status,
		custom_total_cartons: frm.doc.total_cartons,
		custom_total_containers: frm.doc.total_containers
	};

	frappe.route_options = args;
	frappe.new_doc("Purchase Invoice");

	// Wait for the document to load and then add items
	wait_for_document_and_add_items("Purchase Invoice", items_data);
}

// Function to create Delivery Note
function create_delivery_note(frm) {
	if (!frm.doc.items || frm.doc.items.length === 0) {
		frappe.msgprint(__("No items found to create Delivery Note"));
		return;
	}

	// Prepare items data for the new document
	let items_data = [];
	frm.doc.items.forEach(function(item) {
		items_data.push({
			item_code: item.item_code,
			item_name: item.item_name,
			qty: item.quantity,
			uom: item.uom,
			stock_uom: item.stock_uom || item.uom,
			conversion_factor: item.uom_conversion_factor,
			warehouse: item.warehouse,
			barcode: item.barcode,
			description: item.description,
			custom_containers:  item.uomcontainers,
			custom_cartons: item.uomcartons,
		});
	});

	// Navigate to new Delivery Note with pre-filled data
	let args = {
		// customer: frm.doc.customer,
		posting_date: frm.doc.date,
		posting_time: frm.doc.posting_time,
		company: frm.doc.company,
		set_warehouse: frm.doc.ds_warehouse,
		custom_scanning_operation: frm.doc.name,
		custom_invoice_no: frm.doc.scanning_name,
		company_group: frm.doc.company_group,
		cost_center: frm.doc.cost_center,
		project: frm.doc.project,
		marka: frm.doc.marka,
		branch: frm.doc.branch,
		
		custom_container_no: frm.doc.container_no,
		custom_port_of_loading: frm.doc.port_of_loading,
		custom_bill_of_landing: frm.doc.data_ncab,
		custom_bil: frm.doc.bil,
		custom_bill_of_exit: frm.doc.bill_of_exit,
		custom_estimated_date_of_departure: frm.doc.estimated_date_of_departure,
		custom_destination: frm.doc.destination,
		custom_port_of_discharge: frm.doc.port_of_discharge,
		custom_container_quantity: frm.doc.container_quantity,
		custom_shippin_line: frm.doc.shipping_line,
		custom_estimated_date_of_arrival: frm.doc.estimated_date_of_arrival,
		custom_remaining_days: frm.doc.remaining_days,
		custom_actual_arrival_date: frm.doc.actual_arrival_date,
		custom_shipping_status: frm.doc.shipping_status,
		custom_total_cartons: frm.doc.total_cartons,
		custom_total_containers: frm.doc.total_containers
	};

	frappe.route_options = args;
	frappe.new_doc("Delivery Note");

	// Wait for the document to load and then add items
	wait_for_document_and_add_items("Delivery Note", items_data);
}

// Function to create Sales Invoice
function create_sales_invoice(frm) {
	if (!frm.doc.items || frm.doc.items.length === 0) {
		frappe.msgprint(__("No items found to create Sales Invoice"));
		return;
	}

	// Prepare items data for the new document
	let items_data = [];
	
	// First, prepare items data structure
	frm.doc.items.forEach(function(item) {
		items_data.push({
			item_code: item.item_code,
			item_name: item.item_name,
			qty: item.quantity,
			uom: item.uom,
			stock_uom: item.stock_uom || item.uom,
			warehouse: item.warehouse,
			barcode: item.barcode,
			description: item.description,
			custom_containers: item.uomcontainers,
			custom_cartons: item.uomcartons
		});
	});

	// Fetch income accounts for all items before forwarding
	let pending_requests = items_data.length;
	let all_income_accounts_fetched = false;
	
	if (items_data.length > 0 && frm.doc.company) {
		items_data.forEach(function(item_data, index) {
			frappe.call({
				method: "nextlayer.next_layer.doctype.scanning_operation.scanning_operation.get_accounts",
				args: {
					item_code: item_data.item_code,
					company: frm.doc.company
				},
				callback: function(r) {
					pending_requests--;
					if (r.message) {
						item_data.income_account = r.message;
					}
					
					// When all requests are done, proceed with creating the document
					if (pending_requests === 0 && !all_income_accounts_fetched) {
						all_income_accounts_fetched = true;
						proceed_with_sales_invoice_creation(frm, items_data);
					}
				}
			});
		});
	} else {
		// No items or no company, proceed without fetching income accounts
		proceed_with_sales_invoice_creation(frm, items_data);
	}
}

// Function to proceed with Sales Invoice creation after income accounts are fetched
function proceed_with_sales_invoice_creation(frm, items_data) {
	// Navigate to new Sales Invoice with pre-filled data
	let args = {
		// customer: frm.doc.customer,
		posting_date: frm.doc.date,
		posting_time: frm.doc.posting_time,
		company: frm.doc.company,
		set_warehouse: frm.doc.ds_warehouse,
		custom_scanning_operation: frm.doc.name,
		custom_invoice_no: frm.doc.scanning_name,
		company_group: frm.doc.company_group,
		cost_center: frm.doc.cost_center,
		project: frm.doc.project,
		marka: frm.doc.marka,
		branch: frm.doc.branch,
		custom_container_no: frm.doc.container_no,
		custom_port_of_loading: frm.doc.port_of_loading,
		custom_bill_of_landing: frm.doc.data_ncab,
		custom_bil: frm.doc.bil,
		custom_bill_of_exit: frm.doc.bill_of_exit,
		custom_estimated_date_of_departure: frm.doc.estimated_date_of_departure,
		custom_destination: frm.doc.destination,
		custom_port_of_discharge: frm.doc.port_of_discharge,
		custom_container_quantity: frm.doc.container_quantity,
		custom_shippin_line: frm.doc.shipping_line,
		custom_estimated_date_of_arrival: frm.doc.estimated_date_of_arrival,
		custom_remaining_days: frm.doc.remaining_days,
		custom_actual_arrival_date: frm.doc.actual_arrival_date,
		custom_shipping_status: frm.doc.shipping_status,
		custom_total_cartons: frm.doc.total_cartons,
		custom_total_containers: frm.doc.total_containers
	};

	frappe.route_options = args;
	frappe.new_doc("Sales Invoice");

	// Wait for the document to load and then add items
	wait_for_document_and_add_items("Sales Invoice", items_data);
}

// Function to check if we're in verification mode
function is_verification_mode(frm) {
	const current_user = frappe.session.user;
	const scanned_by = frm.doc.scanned_by;
	const verified_by = frm.doc.verified_by;
	
	// Verification mode: current user is the verifier AND not the scanner
	// If user is both scanner and verifier, default to scanner mode (add to quantity)
	if (scanned_by === current_user && verified_by === current_user) {
		return false; // Scanner mode takes priority
	}
	
	// Verification mode: verified_by is set AND current user is the verified_by person
	return verified_by && verified_by === current_user;
}

// Function to check if scanning should be blocked
function should_block_scanning(frm) {
	// Scanner and verifier can work simultaneously - no blocking
	return false;
}

// Function to process barcode scan
function process_barcode_scan(frm) {
	let barcode = frm.doc.scan_barcode;

	if (!barcode) return;

	const current_user = frappe.session.user;
	const scanned_by = frm.doc.scanned_by;
	const verified_by = frm.doc.verified_by;

	// Check if we're in verification mode
	const is_verifier = verified_by && verified_by === current_user;
	const is_scanner = scanned_by && scanned_by === current_user;

	// If not in verification mode, only scanned_by user can scan (add to quantity)
	if (!is_verifier) {
		if (!scanned_by) {
			frappe.msgprint({
				title: __("Scanner Not Selected"),
				message: __("Please select 'Scanned By' user before scanning items."),
				indicator: "orange"
			});
			frm.set_value("scan_barcode", "");
			return;
		}

		if (scanned_by !== current_user) {
			frappe.msgprint({
				title: __("Scanning Restricted"),
				message: __("Only the selected scanner ({0}) can scan items. Please log in as the scanner to scan items.", [scanned_by]),
				indicator: "red"
			});
			frm.set_value("scan_barcode", "");
			return;
		}
	}

	// Clear the barcode field immediately for next scan
	frm.set_value("scan_barcode", "");

	// Call server method to get item details
	frappe.call({
		method: "nextlayer.next_layer.doctype.scanning_operation.scanning_operation.get_item_by_barcode",
		args: {
			barcode: barcode
		},
		callback: function(r) {
			if (r.message) {
				console.log("Our data",r.message);
				if (is_verification_mode(frm)) {
					add_item_to_table_for_verification(frm, r.message);
				} else {
					add_item_to_table(frm, r.message);
				}
			} else {
				frappe.msgprint(__("Item not found for barcode: {0}", [barcode]));
			}
		}
	});
}

// Function to add item to the items table
function add_item_to_table(frm, item_data) {
	let warehouse = "";

	// Set default warehouse based on operation
	if (frm.doc.operation === "Loading" && frm.doc.ds_warehouse) {
		warehouse = frm.doc.ds_warehouse;
	} else if (frm.doc.operation === "Offloading" && frm.doc.dt_warehouse) {
		warehouse = frm.doc.dt_warehouse;
	}

	// Check if item already exists in table (same item + warehouse combination)
	let existing_row = null;
	if (frm.doc.items) {
		frm.doc.items.forEach(function(row, index) {
			if (row.item_code === item_data.item_code && row.warehouse === warehouse) {
				existing_row = index;
			}
		});
	}


	if (existing_row !== null) {
		// Update quantity of existing item (like POS behavior)
		let current_qty = frm.doc.items[existing_row].quantity || 0;
		let new_qty = current_qty + 1;

		// Directly modify the row data to avoid triggering form events
		frm.doc.items[existing_row].quantity = new_qty;

		// Trigger form refresh and auto-save
			frm.refresh_field("items");
			// Auto-save after each scan increment
			frm.save();


		frappe.show_alert(__("Quantity increased to {0} for {1}", [new_qty, item_data.item_name]));
	} else {
		// Add new item to table
		let new_row = frm.add_child("items");

		// Set values directly on the row object
		new_row.item_code = item_data.item_code;
		new_row.item_name = item_data.item_name;
		new_row.quantity = 1;
		new_row.barcode = item_data.barcode;
		new_row.warehouse = warehouse;

		// Prefer sales_uom; fallback to parent Scanning Operation.uom
		if (item_data.sales_uom) {
			new_row.uom = item_data.sales_uom;
		} else if (frm.doc && frm.doc.uom) {
			new_row.uom = frm.doc.uom;
		}

		if (item_data.description) {
			new_row.description = item_data.description;
		}

		frappe.show_alert(__("Item {0} added successfully", [item_data.item_name]));

		// Auto-save after adding a new row so server computes conversions and totals
		frm.save();
	}

	frm.refresh_field("items");

	// Set focus back to barcode field for next scan
	setTimeout(function() {
		if (frm.fields_dict.scan_barcode) {
			frm.fields_dict.scan_barcode.set_focus();
		}
	}, 100);
}

// Function to add item to table for verification (adds to verified_qty instead of quantity)
function add_item_to_table_for_verification(frm, item_data) {
	let warehouse = "";

	// Set default warehouse based on operation
	if (frm.doc.operation === "Loading" && frm.doc.ds_warehouse) {
		warehouse = frm.doc.ds_warehouse;
	} else if (frm.doc.operation === "Offloading" && frm.doc.dt_warehouse) {
		warehouse = frm.doc.dt_warehouse;
	}

	// Find existing item row (same item + warehouse combination)
	let existing_row = null;
	if (frm.doc.items) {
		frm.doc.items.forEach(function(row, index) {
			if (row.item_code === item_data.item_code && row.warehouse === warehouse) {
				existing_row = index;
			}
		});
	}

	if (existing_row !== null) {
		// Check if verified_qty is going beyond scanned quantity
		let scanned_qty = frm.doc.items[existing_row].quantity || 0;
		let current_verified_qty = frm.doc.items[existing_row].verified_qty || 0;
		let new_verified_qty = current_verified_qty + 1;

		// Validate: verifier cannot verify beyond what was scanned
		if (new_verified_qty > scanned_qty) {
			frappe.msgprint({
				title: __("Verification Error"),
				message: __("Cannot verify beyond scanned quantity. Scanned: {0}, Verified: {1}. Please ask the scanner to scan again and correct the quantities.", [scanned_qty, current_verified_qty]),
				indicator: "red"
			});
			frm.set_value("scan_barcode", "");
			return;
		}

		// Update verified_qty of existing item
		frm.doc.items[existing_row].verified_qty = new_verified_qty;

		// Trigger form refresh and auto-save
		frm.refresh_field("items");
		frm.save();

		frappe.show_alert({
			message: __("Verified quantity increased to {0} for {1}", [new_verified_qty, item_data.item_name]),
			indicator: "blue"
		});
	} else {
		// Item not found in original scan - show error
		frappe.msgprint({
			title: __("Item Not Found in Original Scan"),
			message: __("Item {0} with barcode {1} was not found in the original scan. Verifier can only verify items that were originally scanned. Please ask the scanner to scan this item first.", [item_data.item_name, item_data.barcode]),
			indicator: "red"
		});
		frm.set_value("scan_barcode", "");
		return;
	}

	frm.refresh_field("items");

	// Set focus back to barcode field for next scan
	setTimeout(function() {
		if (frm.fields_dict.scan_barcode) {
			frm.fields_dict.scan_barcode.set_focus();
		}
	}, 100);
}

// Function to auto-fill missing warehouses
function auto_fill_missing_warehouses(frm) {
	if (!frm.doc.items || frm.doc.items.length === 0) return;

	let default_warehouse = "";
	let items_with_warehouse = [];
	let items_without_warehouse = [];

	// Determine default warehouse based on operation
	if (frm.doc.operation === "Loading" && frm.doc.ds_warehouse) {
		default_warehouse = frm.doc.ds_warehouse;
	} else if (frm.doc.operation === "Offloading" && frm.doc.dt_warehouse) {
		default_warehouse = frm.doc.dt_warehouse;
	}

	// Categorize items
	frm.doc.items.forEach(function(item, index) {
		if (item.warehouse) {
			items_with_warehouse.push(item.warehouse);
		} else {
			items_without_warehouse.push(index);
		}
	});

	// Auto-fill missing warehouses
	if (items_without_warehouse.length > 0) {
		let warehouse_to_use = "";

		// Priority 1: Use default warehouse if available
		if (default_warehouse) {
			warehouse_to_use = default_warehouse;
		}
		// Priority 2: Use warehouse from existing items
		else if (items_with_warehouse.length > 0) {
			warehouse_to_use = items_with_warehouse[0]; // Use first available warehouse
		}

		// Apply warehouse to items without warehouse
		if (warehouse_to_use) {
			items_without_warehouse.forEach(function(index) {
				frm.set_value("items", index, "warehouse", warehouse_to_use);
			});

			frappe.show_alert(__("Auto-filled warehouse '{0}' for {1} items", [warehouse_to_use, items_without_warehouse.length]));
		}
	}
}

// Function to setup party filters based on company
// function setup_party_filters(frm) {
// 	if (!frm.doc.company) return;

// 	// Setup customer filter for Loading operations
// 	frm.set_query("customer", function() {
// 		return {
// 			filters: [
// 				["Customer", "disabled", "!=", 1]
// 			]
// 		};
// 	});

// 	// Setup supplier filter for Offloading operations
// 	frm.set_query("supplier", function() {
// 		return {
// 			filters: [
// 				["Supplier", "disabled", "!=", 1]
// 			]
// 		};
// 	});

// 	// Apply company-based restrictions
// 	frappe.call({
// 		method: "nextlayer.next_layer.doctype.scanning_operation.scanning_operation.get_customers_or_suppliers_by_company",
// 		args: {
// 			company: frm.doc.company,
// 			parenttype: "Customer",
// 		},
// 		callback: function(r) {
// 			if (!r.message) return;

// 			const { allowed_parties, restrict_selling_settings } = r.message;

// 			if (restrict_selling_settings) {
// 				// Restrict Customer field
// 				frm.set_query("customer", function() {
// 					return {
// 						filters: [
// 							["Customer", "name", "in", allowed_parties],
// 							["Customer", "disabled", "!=", 1]
// 						]
// 					};
// 				});
// 			}
// 		}
// 	});

// 	frappe.call({
// 		method: "nextlayer.next_layer.doctype.scanning_operation.scanning_operation.get_customers_or_suppliers_by_company",
// 		args: {
// 			company: frm.doc.company,
// 			parenttype: "Supplier",
// 		},
// 		callback: function(r) {
// 			if (!r.message) return;

// 			const { allowed_parties, restrict_buying_settings } = r.message;

// 			if (restrict_buying_settings) {
// 				// Restrict Supplier field
// 				frm.set_query("supplier", function() {
// 					return {
// 						filters: [
// 							["Supplier", "name", "in", allowed_parties],
// 							["Supplier", "disabled", "!=", 1]
// 						]
// 					};
// 				});
// 			}
// 		}
// 	});
// }

// Function to setup warehouse filters based on company
function setup_warehouse_filters(frm) {
	// Set up filter for Default Source Warehouse
	frm.set_query("ds_warehouse", function() {
		return {
			filters: {
				company: frm.doc.company || ""
			}
		};
	});

	// Set up filter for Default Target Warehouse
	frm.set_query("dt_warehouse", function() {
		return {
			filters: {
				company: frm.doc.company || ""
			}
		};
	});

	// Set up filter for warehouse field in items table
	frm.set_query("warehouse", "items", function() {
		return {
			filters: {
				company: frm.doc.company || ""
			}
		};
	});
}

// Function to setup accounting dimension filters based on company
function setup_accounting_dimension_filters(frm) {
	// Set up filter for Cost Center - filter by company field
	frm.set_query("cost_center", function() {
		return {
			filters: {
				company: frm.doc.company || ""
			}
		};
	});

	// Set up filter for Project - filter by company field
	frm.set_query("project", function() {
		return {
			filters: {
				company: frm.doc.company || ""
			}
		};
	});

	// Set up filter for Branch - filter by custom_company field
	frm.set_query("branch", function() {
		return {
			filters: {
				custom_company: frm.doc.company || ""
			}
		};
	});
}

// Function to setup decrease button handlers for all rows
function setup_decrease_buttons(frm) {
	if (!frm.fields_dict.items || !frm.fields_dict.items.grid || !frm.fields_dict.items.grid.wrapper) {
		// Grid not ready yet, try again after a short delay
		setTimeout(function() {
			setup_decrease_buttons(frm);
		}, 200);
		return;
	}
	
	let grid_wrapper = frm.fields_dict.items.grid.wrapper;
	
	// Remove existing handlers to avoid duplicates
	$(grid_wrapper).off('click', '.grid-row [data-fieldname="decrease"]');
	
	// Attach click handler using event delegation
	$(grid_wrapper).on('click', '.grid-row [data-fieldname="decrease"]', function(e) {
		e.stopPropagation();
		e.preventDefault();
		
		let $row = $(this).closest('.grid-row');
		let row_name = $row.attr('data-name');
		
		if (row_name) {
			let row = locals['Scanning Operation Detail'][row_name];
			if (row) {
				handle_decrease_quantity(frm, 'Scanning Operation Detail', row_name, row);
			}
		}
	});
}

// Function to setup decrease button handler for a specific row
function setup_decrease_button_for_row(frm, cdt, cdn) {
	if (!frm.fields_dict.items || !frm.fields_dict.items.grid || !frm.fields_dict.items.grid.wrapper) {
		return;
	}
	
	setTimeout(function() {
		let grid_wrapper = frm.fields_dict.items.grid.wrapper;
		let $row = $(grid_wrapper).find(`.grid-row[data-name="${cdn}"]`);
		let $button = $row.find('[data-fieldname="decrease"]');
		
		if ($button.length > 0) {
			$button.off('click.decrease').on('click.decrease', function(e) {
				e.stopPropagation();
				e.preventDefault();
				let row = locals[cdt][cdn];
				if (row) {
					handle_decrease_quantity(frm, cdt, cdn, row);
				}
			});
		}
	}, 100);
}

// Function to handle decrease quantity
function handle_decrease_quantity(frm, cdt, cdn, row) {
	console.log("Decrease button clicked for row:", cdn, row);
	
	let current_qty = row.quantity || 0;
	let current_verified_qty = row.verified_qty || 0;
	
	if (current_qty > 0) {
		let new_qty = current_qty - 1;
		
		// If verified_qty is greater than new quantity, reduce it to match
		let new_verified_qty = current_verified_qty;
		if (current_verified_qty > new_qty) {
			new_verified_qty = new_qty;
		}
		
		// Update quantity first
		frappe.model.set_value(cdt, cdn, "quantity", new_qty, function() {
			// Update verified_qty if needed
			if (current_verified_qty > new_qty) {
				frappe.model.set_value(cdt, cdn, "verified_qty", new_verified_qty, function() {
					// Trigger quantity field change to recalculate UOM conversions
					// This will ensure all calculations are updated
					trigger_quantity_recalculation(frm, cdt, cdn);
				});
			} else {
				// Trigger quantity field change to recalculate UOM conversions
				trigger_quantity_recalculation(frm, cdt, cdn);
			}
		});
	} else {
		frappe.msgprint(__("Quantity cannot be reduced below 0"));
	}
}

// Function to trigger recalculation after quantity change
function trigger_quantity_recalculation(frm, cdt, cdn) {
	// Refresh the items table to update UI
	frm.refresh_field("items");
	
	// Auto-save after decreasing quantity - this will trigger validate() 
	// which calls compute_uom_conversions_and_totals() to recalculate everything
	// The validate() method will:
	// 1. Recalculate all UOM conversions (uom_cartons, uom_containers, qty_as_per_stock_uom)
	// 2. Recalculate totals (total_pairs, total_cartons, total_containers)
	// 3. Recalculate verification status
	frm.save(function() {
		// After save completes, refresh all fields to show updated calculations
		frm.refresh_field("items");
		frm.refresh_field("total_pairs");
		frm.refresh_field("total_cartons");
		frm.refresh_field("total_containers");
		frm.refresh_field("verification_status");
		
		let row = locals[cdt][cdn];
		if (row) {
			frappe.show_alert(__("Quantity decreased to {0} for {1}", [row.quantity, row.item_name || row.item_code]));
		}
	});
}

// Function to setup verification mode restrictions
function setup_verification_mode(frm) {
	const current_user = frappe.session.user;
	const scanned_by = frm.doc.scanned_by;
	const verified_by = frm.doc.verified_by;

	// Enable barcode field for scanner or verifier
	if (scanned_by === current_user || verified_by === current_user) {
		if (frm.fields_dict.scan_barcode) {
			frm.set_df_property("scan_barcode", "read_only", false);
			
			// Set description based on user role
			if (scanned_by === current_user && verified_by === current_user) {
				frm.set_df_property("scan_barcode", "description", __("You are both scanner and verifier. Scanning will add to quantity."));
			} else if (scanned_by === current_user) {
				frm.set_df_property("scan_barcode", "description", __("Scanner mode: Scanning will add to quantity."));
			} else if (verified_by === current_user) {
				frm.set_df_property("scan_barcode", "description", __("Verification mode: Scanning will add to verified quantity."));
				
				// Show verification mode indicator
				if (!frm.doc.__verification_mode_indicator_shown) {
					frappe.show_alert({
						message: __("Verification mode active. Scanning will verify items."),
						indicator: "blue"
					}, 3);
					frm.doc.__verification_mode_indicator_shown = true;
				}
			}
		}
	} else {
		// If current user is neither scanner nor verifier, disable scanning
		if (frm.fields_dict.scan_barcode) {
			frm.set_df_property("scan_barcode", "read_only", true);
			if (!scanned_by && !verified_by) {
				frm.set_df_property("scan_barcode", "description", __("Please select 'Scanned By' or 'Verified By' user before scanning."));
			} else {
				frm.set_df_property("scan_barcode", "description", __("Only the scanner or verifier can scan items."));
			}
		}
	}

	// Refresh the field to apply changes
	if (frm.fields_dict.scan_barcode) {
		frm.refresh_field("scan_barcode");
	}
}

// Robust function to wait for document to load and add items
function wait_for_document_and_add_items(doctype, items_data) {
	let attempts = 0;
	const max_attempts = 20; // Maximum 10 seconds (20 * 500ms)

	function try_add_items() {
		attempts++;

		// Check if the current form is the target doctype
		if (cur_frm && cur_frm.doctype === doctype) {

			try {
				// Clear any existing items first
				cur_frm.clear_table("items");

				// Add items one by one with error handling
				items_data.forEach(function(item_data, index) {
					try {
						let new_row = cur_frm.add_child("items");
						new_row.item_code = item_data.item_code;
						new_row.item_name = item_data.item_name;
						new_row.qty = item_data.qty;
						new_row.uom = item_data.uom;
						new_row.stock_uom = item_data.stock_uom || item_data.uom;
						new_row.warehouse = item_data.warehouse;

						if (item_data.barcode) {
							new_row.barcode = item_data.barcode;
						}
						if (item_data.description) {
							new_row.description = item_data.description;
						}

						// For Delivery Note, forward custom UOM fields
						if (doctype === "Delivery Note") {
							if (item_data.uomcontainers !== undefined && item_data.uomcontainers !== null) {
								new_row.custom_uom_container = item_data.uomcontainers;
							}
							if (item_data.uomcartons !== undefined && item_data.uomcartons !== null) {
								new_row.custom_uom_cartons = item_data.uomcartons;
							}
						}

						// For Sales Invoice, set income account if available
						if (doctype === "Sales Invoice" && item_data.income_account) {
							new_row.income_account = item_data.income_account;
						}

					} catch (item_error) {
						console.error(`Error adding item ${index + 1}:`, item_error);
						frappe.msgprint(__("Error adding item {0}: {1}", [item_data.item_code, item_error.message]));
					}
				});

				// Refresh the field to show the items
				cur_frm.refresh_field("items");

				// Show success message
				frappe.show_alert(__("Successfully added {0} items to {1}", [items_data.length, doctype]));

			} catch (error) {
				console.error(`Error adding items to ${doctype}:`, error);
				frappe.msgprint(__("Error adding items to {0}: {1}", [doctype, error.message]));
			}

		} else if (attempts < max_attempts) {
			// Document not ready yet, try again
			setTimeout(try_add_items, 500);
		} else {
			// Max attempts reached
			console.error(`Failed to load ${doctype} after ${max_attempts} attempts`);
			frappe.msgprint(__("Failed to load {0} document. Please try creating the document manually.", [doctype]));
		}
	}

	// Start the first attempt after a short delay
	setTimeout(try_add_items, 500);
}


frappe.ui.form.on("Scanning Operation Detail", {
	items_add: function(frm, cdt, cdn) {
		let row = locals[cdt][cdn];

		if (!row.quantity) {
			frappe.model.set_value(cdt, cdn, "quantity", 1);
		}
	},

});
