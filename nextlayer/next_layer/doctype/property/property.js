// Copyright (c) 2026, jr@gmail.com and contributors
// For license information, please see license.txt

frappe.ui.form.on("Property", {
	refresh(frm) {

	},
     width: function(frm) {
        calculate_area(frm);
    },
    length: function(frm) {
        calculate_area(frm);
    },
});

function calculate_area(frm) {
    let width = frm.doc.width || 0;
    let length = frm.doc.length || 0;

    let area = width * length;
    frm.set_value('total_area', area);
}

