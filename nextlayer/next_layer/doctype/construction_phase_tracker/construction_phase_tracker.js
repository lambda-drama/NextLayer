// Copyright (c) 2026, jr@gmail.com and contributors
// For license information, please see license.txt

// frappe.ui.form.on("Construction Phase Tracker", {
// 	refresh(frm) {

// 	},
// });
frappe.ui.form.on('Construction Phase Tracker', {
    onload: function(frm) {
        set_project_filter(frm);
    },

    company: function(frm) {
        // Clear project when company changes
        frm.set_value('project', null);
        set_project_filter(frm);
    }
});

function set_project_filter(frm) {
    frm.set_query('project', function() {
        return {
            filters: {
                company: frm.doc.company
            }
        };
    });
}