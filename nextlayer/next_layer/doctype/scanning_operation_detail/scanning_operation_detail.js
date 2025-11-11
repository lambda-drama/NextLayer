// Copyright (c) 2025, jr@gmail.com and contributors
// For license information, please see license.txt

frappe.ui.form.on("Scanning Operation Detail", {
	barcode(frm, cdt, cdn) {
		let row = locals[cdt][cdn];
		if (row.barcode) {
			// Call server method to get item details by barcode
			frappe.call({
				method: "nextlayer.next_layer.doctype.scanning_operation.scanning_operation.get_item_by_barcode",
				args: {
					barcode: row.barcode
				},
				callback: function(r) {
					if (r.message) {
						frm.set_value(cdt, cdn, "item_code", r.message.item_code);
						frm.set_value(cdt, cdn, "item_name", r.message.item_name);
						frm.set_value(cdt, cdn, "quantity", 1);

						if (r.message.description) {
							frm.set_value(cdt, cdn, "description", r.message.description);
						}

						// Prefer sales_uom; fallback to parent Scanning Operation.uom
						let uom_to_set = r.message.sales_uom || (frm.doc && frm.doc.uom) || null;
						if (uom_to_set) {
							frm.set_value(cdt, cdn, "uom", uom_to_set);
						}

						frappe.show_alert(__("Item details populated from barcode"));
					} else {
						frappe.msgprint(__("Item not found for barcode: {0}", [row.barcode]));
					}
				}
			});
		}
	},

	quantity(frm, cdt, cdn) {
		let row = locals[cdt][cdn];
		if (row.quantity && row.quantity < 0) {
			frm.set_value(cdt, cdn, "quantity", 0);
			frappe.msgprint(__("Quantity cannot be negative"));
		}
	},
	item_code(frm, cdt, cdn) {
		// Set default quantity to 1 when item code is manually selected
		let row = locals[cdt][cdn];
		console.log("Item code selected:", row.item_code, "Current quantity:", row.quantity);

		if (row.item_code) {
			// Set quantity to 1 immediately if it's 0 or empty
			if (!row.quantity || row.quantity === 0) {
				console.log("Setting quantity to 1 for item:", row.item_code);
				frm.set_value(cdt, cdn, "quantity", 1);
				frm.refresh_field("quantity");
			}

			// Fetch item details
			frappe.call({
				method: "frappe.client.get_value",
				args: {
					doctype: "Item",
					filters: { name: row.item_code },
				fieldname: ["item_name", "description", "stock_uom", "sales_uom"]
				},
				callback: function(r) {
					if (r.message) {
						frm.set_value(cdt, cdn, "item_name", r.message.item_name);
						if (r.message.description) {
							frm.set_value(cdt, cdn, "description", r.message.description);
						}
						// Prefer sales_uom; fallback to parent Scanning Operation.uom
						let uom_to_set = r.message.sales_uom || (frm.doc && frm.doc.uom) || null;
						if (uom_to_set) {
							frm.set_value(cdt, cdn, "uom", uom_to_set);
						}
					}
				}
			});
		}
	},

});

