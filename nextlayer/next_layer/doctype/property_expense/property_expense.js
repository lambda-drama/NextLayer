// Copyright (c) 2026, jr@gmail.com and contributors
// For license information, please see license.txt

// frappe.ui.form.on("Property Expense", {
// 	refresh(frm) {

// 	},
// });

frappe.ui.form.on('Property Expense', {
    refresh(frm) {
        if (!frm.doc.is_accounted && frm.doc.docstatus === 1) {
            frm.add_custom_button(__("Generate Journal Entry"), () => {
                generate_journal_entry(frm);
            }, __("Accounting"));
        }
        
        if (frm.doc.journal_entry) {
            frm.add_custom_button(__("View Journal Entry"), () => {
                frappe.set_route("Form", "Journal Entry", frm.doc.journal_entry);
            }, __("Accounting"));
        }
    }
});

function generate_journal_entry(frm) {
    frappe.confirm(__("Generate journal entry for this expense?"), () => {
        frm.call({
            method: "create_journal_entry",
            doc: frm.doc,
            callback: function(r) {
                if (r.message) {
                    frappe.msgprint(__("Journal Entry {0} created successfully", [r.message]));
                    frm.reload_doc();
                }
            }
        });
    });
}

