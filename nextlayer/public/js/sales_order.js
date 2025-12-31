// Copyright (c) 2025, jr@gmail.com and contributors
// For license information, please see license.txt

frappe.ui.form.on("Sales Order", {
	// When custom_autocreate_payment_entry checkbox changes
	custom_autocreate_payment_entry: function(frm) {
		if (frm.doc.custom_autocreate_payment_entry && frm.doc.rounded_total) {
			frm.set_value("custom_paid_amount", frm.doc.rounded_total);
			frm.refresh_field("custom_paid_amount");
		}
	},
	
	// When rounded_total changes, update custom_paid_amount if checkbox is ticked
	rounded_total: function(frm) {
		if (frm.doc.custom_autocreate_payment_entry && frm.doc.rounded_total) {
			frm.set_value("custom_paid_amount", frm.doc.rounded_total);
			frm.refresh_field("custom_paid_amount");
		}
	},
	
	// Before save - ensure custom_paid_amount is set if checkbox is ticked
	before_save: function(frm) {
		if (frm.doc.custom_autocreate_payment_entry && frm.doc.rounded_total) {
			frm.set_value("custom_paid_amount", frm.doc.rounded_total);
		}
	}
});

