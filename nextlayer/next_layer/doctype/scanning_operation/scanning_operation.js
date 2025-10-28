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
	},

	company(frm) {
		// Clear warehouse fields when company changes
		frm.set_value("ds_warehouse", "");
		frm.set_value("dt_warehouse", "");

		// Update warehouse filters
		setup_warehouse_filters(frm);

		// Setup customer/supplier filters based on company
		// setup_party_filters(frm);
	},

	scan_barcode(frm) {
		if (frm.doc.scan_barcode) {
			process_barcode_scan(frm);
		}
	},

	operation(frm) {
		// Clear warehouse fields and party fields when operation changes
		frm.set_value("ds_warehouse", "");
		frm.set_value("dt_warehouse", "");
		// frm.set_value("customer", "");
		// frm.set_value("supplier", "");
	},

	// customer(frm) {
	// 	if (!frm.doc.customer || !frm.doc.company) return;

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
	// 				if (!allowed_parties.includes(frm.doc.customer)) {
	// 					frappe.throw('Customer not authorized to transact!')
	// 				}
	// 			}
	// 		}
	// 	});
	// },

	// supplier(frm) {
	// 	if (!frm.doc.supplier || !frm.doc.company) return;

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
	// 				if (!allowed_parties.includes(frm.doc.supplier)) {
	// 					frappe.throw('Supplier not authorized to transact!')
	// 				}
	// 			}
	// 		}
	// 	});
	// },

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
			stock_uom: item.uom,
			warehouse: item.warehouse,
			barcode: item.barcode,
			description: item.description
		});
	});

	// Navigate to new Purchase Receipt with pre-filled data
	let args = {
		supplier: frm.doc.supplier,
		posting_date: frm.doc.date,
		posting_time: frm.doc.posting_time,
		company: frm.doc.company,
		set_warehouse: frm.doc.dt_warehouse,
		scanning_operation: frm.doc.name
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
			stock_uom: item.uom,
			warehouse: item.warehouse,
			barcode: item.barcode,
			description: item.description
		});
	});

	// Navigate to new Purchase Invoice with pre-filled data
	let args = {
		supplier: frm.doc.supplier,
		posting_date: frm.doc.date,
		posting_time: frm.doc.posting_time,
		company: frm.doc.company,
		set_warehouse: frm.doc.dt_warehouse,
		scanning_operation: frm.doc.name
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
			stock_uom: item.uom,
			warehouse: item.warehouse,
			barcode: item.barcode,
			description: item.description
		});
	});

	// Navigate to new Delivery Note with pre-filled data
	let args = {
		// customer: frm.doc.customer,
		posting_date: frm.doc.date,
		posting_time: frm.doc.posting_time,
		company: frm.doc.company,
		set_warehouse: frm.doc.ds_warehouse,
		scanning_operation: frm.doc.name
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
	frm.doc.items.forEach(function(item) {
		items_data.push({
			item_code: item.item_code,
			item_name: item.item_name,
			qty: item.quantity,
			uom: item.uom,
			stock_uom: item.uom,
			warehouse: item.warehouse,
			barcode: item.barcode,
			description: item.description
		});
	});

	// Navigate to new Sales Invoice with pre-filled data
	let args = {
		// customer: frm.doc.customer,
		posting_date: frm.doc.date,
		posting_time: frm.doc.posting_time,
		company: frm.doc.company,
		set_warehouse: frm.doc.ds_warehouse,
		scanning_operation: frm.doc.name
	};

	frappe.route_options = args;
	frappe.new_doc("Sales Invoice");

	// Wait for the document to load and then add items
	wait_for_document_and_add_items("Sales Invoice", items_data);
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

		// Trigger form calculations and refresh with a small delay
			frm.refresh_field("items");
		

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
						new_row.stock_uom = item_data.uom;
						new_row.warehouse = item_data.warehouse;

						if (item_data.barcode) {
							new_row.barcode = item_data.barcode;
						}
						if (item_data.description) {
							new_row.description = item_data.description;
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
