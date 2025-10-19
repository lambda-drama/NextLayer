// Copyright (c) 2025, jr@gmail.com and contributors
// For license information, please see license.txt

frappe.ui.form.on("Scanning Operation Detail", {
	item_code(frm, cdt, cdn) {
		let row = locals[cdt][cdn];
		if (row.item_code) {
			frappe.call({
				method: "frappe.client.get_value",
				args: {
					doctype: "Item",
					filters: { name: row.item_code },
					fieldname: ["item_name", "description", "stock_uom"]
				},
				callback: function(r) {
					if (r.message) {
						frm.set_value(cdt, cdn, "item_name", r.message.item_name);
						if (r.message.description) {
							frm.set_value(cdt, cdn, "description", r.message.description);
						}
						if (r.message.stock_uom) {
							frm.set_value(cdt, cdn, "uom", r.message.stock_uom);
						}
					}
				}
			});
		}
	},

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

						if (r.message.stock_uom) {
							frm.set_value(cdt, cdn, "uom", r.message.stock_uom);
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
	}
});
