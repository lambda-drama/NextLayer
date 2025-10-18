// Copyright (c) 2025, jr@gmail.com and contributors
// For license information, please see license.txt

frappe.ui.form.on("Scanning Operation", {
	refresh(frm) {
		// Set focus on barcode field for automatic scanning
		if (frm.doc.scan_barcode && frm.fields_dict.scan_barcode) {
			frm.fields_dict.scan_barcode.set_focus();
		}

		// Add Create buttons group only after document is submitted
		if (frm.doc.docstatus === 1) {
			add_create_buttons(frm);
		}

		// Setup automatic barcode detection
		setup_automatic_barcode_detection(frm);
	},

	scan_barcode(frm) {
		if (frm.doc.scan_barcode) {
			process_barcode_scan(frm);
		}
	},

	operation(frm) {
		// Clear warehouse fields when operation changes
		frm.set_value("ds_warehouse", "");
		frm.set_value("dt_warehouse", "");
	},

	before_save(frm) {
		// Auto-fill missing warehouses before submit
		auto_fill_missing_warehouses(frm);
	}
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

	// Navigate to new Purchase Receipt with pre-filled data
	let args = {
		supplier: frm.doc.customer,
		posting_date: frm.doc.date,
		posting_time: frm.doc.posting_time,
		company: frm.doc.company,
		set_warehouse: frm.doc.dt_warehouse,
		scanning_operation: frm.doc.name
	};

	frappe.route_options = args;
	frappe.new_doc("Purchase Receipt");

	// Set up items loading after navigation
	setTimeout(function() {
		load_items_to_current_form("Purchase Receipt");
	}, 1000);
}

// Function to create Purchase Invoice
function create_purchase_invoice(frm) {
	if (!frm.doc.items || frm.doc.items.length === 0) {
		frappe.msgprint(__("No items found to create Purchase Invoice"));
		return;
	}

	// Navigate to new Purchase Invoice with pre-filled data
	let args = {
		supplier: frm.doc.customer,
		posting_date: frm.doc.date,
		posting_time: frm.doc.posting_time,
		company: frm.doc.company,
		set_warehouse: frm.doc.dt_warehouse,
		scanning_operation: frm.doc.name
	};

	frappe.route_options = args;
	frappe.new_doc("Purchase Invoice");

	// Set up items loading after navigation
	setTimeout(function() {
		load_items_to_current_form("Purchase Invoice");
	}, 1000);
}

// Function to create Delivery Note
function create_delivery_note(frm) {
	if (!frm.doc.items || frm.doc.items.length === 0) {
		frappe.msgprint(__("No items found to create Delivery Note"));
		return;
	}

	// Navigate to new Delivery Note with pre-filled data
	let args = {
		customer: frm.doc.customer,
		posting_date: frm.doc.date,
		posting_time: frm.doc.posting_time,
		company: frm.doc.company,
		set_warehouse: frm.doc.ds_warehouse,
		scanning_operation: frm.doc.name
	};

	frappe.route_options = args;
	frappe.new_doc("Delivery Note");

	// Set up items loading after navigation
	setTimeout(function() {
		load_items_to_current_form("Delivery Note");
	}, 1000);
}

// Function to create Sales Invoice
function create_sales_invoice(frm) {
	if (!frm.doc.items || frm.doc.items.length === 0) {
		frappe.msgprint(__("No items found to create Sales Invoice"));
		return;
	}

	// Navigate to new Sales Invoice with pre-filled data
	let args = {
		customer: frm.doc.customer,
		posting_date: frm.doc.date,
		posting_time: frm.doc.posting_time,
		company: frm.doc.company,
		set_warehouse: frm.doc.ds_warehouse,
		scanning_operation: frm.doc.name
	};

	frappe.route_options = args;
	frappe.new_doc("Sales Invoice");

	// Set up items loading after navigation
	setTimeout(function() {
		load_items_to_current_form("Sales Invoice");
	}, 1000);
}

// Function to process barcode scan
function process_barcode_scan(frm) {
	let barcode = frm.doc.scan_barcode;

	if (!barcode) return;

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
				add_item_to_table(frm, r.message);
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
			console.log("Checking row", index, ":", row.item_code, "vs", item_data.item_code, "|", row.warehouse, "vs", warehouse);
			if (row.item_code === item_data.item_code && row.warehouse === warehouse) {
				existing_row = index;
				console.log("Found existing row at index:", index);
			}
		});
	}

	console.log("Existing row found:", existing_row);

	if (existing_row !== null) {
		// Update quantity of existing item (like POS behavior)
		let current_qty = frm.doc.items[existing_row].quantity || 0;
		let new_qty = current_qty + 1;
		console.log("Updating quantity:", current_qty, "->", new_qty, "for row", existing_row);

		frm.set_value("items", existing_row, "quantity", new_qty);
		frm.refresh_field("items"); // Refresh the table to show updated quantity
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

		if (item_data.description) {
			new_row.description = item_data.description;
		}

		frappe.show_alert(__("Item {0} added successfully", [item_data.item_name]));
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

// Function to load items to current form after navigation
function load_items_to_current_form(doctype) {
	// Get the scanning operation name from route options
	let scanning_operation = frappe.route_options ? frappe.route_options.scanning_operation : null;

	if (!scanning_operation) return;

	// Call server to get items
	frappe.call({
		method: "nextlayer.next_layer.doctype.scanning_operation.scanning_operation.get_items_from_scanning_operation",
		args: {
			scanning_operation: scanning_operation
		},
		callback: function(r) {
			if (r.message && r.message.items && cur_frm && cur_frm.doctype === doctype) {
				// Clear existing items
				cur_frm.clear_table("items");

				// Add items from scanning operation
				r.message.items.forEach(function(item) {
					let new_row = cur_frm.add_child("items");
					new_row.item_code = item.item_code;
					new_row.qty = item.quantity;
					new_row.warehouse = item.warehouse;
					if (item.description) {
						new_row.description = item.description;
					}
				});

				cur_frm.refresh_field("items");
				frappe.show_alert(__("Items loaded from Scanning Operation"));
			}
		}
	});
}

