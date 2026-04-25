// Copyright (c) 2026, jr@gmail.com and contributors
// For license information, please see license.txt

// frappe.ui.form.on("Property Expense", {
// 	refresh(frm) {

// 	},
// });

// frappe.ui.form.on('Property Expense', {
//     refresh(frm) {
//         if (!frm.doc.is_accounted && frm.doc.docstatus === 1) {
//             frm.add_custom_button(__("Generate Journal Entry"), () => {
//                 generate_journal_entry(frm);
//             }, __("Accounting"));
//         }
        
//         if (frm.doc.journal_entry) {
//             frm.add_custom_button(__("View Journal Entry"), () => {
//                 frappe.set_route("Form", "Journal Entry", frm.doc.journal_entry);
//             }, __("Accounting"));
//         }
//     }
// });

// function generate_journal_entry(frm) {
//     frappe.confirm(__("Generate journal entry for this expense?"), () => {
//         frm.call({
//             method: "create_journal_entry",
//             doc: frm.doc,
//             callback: function(r) {
//                 if (r.message) {
//                     frappe.msgprint(__("Journal Entry {0} created successfully", [r.message]));
//                     frm.reload_doc();
//                 }
//             }
//         });
//     });
// }


frappe.ui.form.on('Property Expense', {
    refresh(frm) {
        // Show button only if not already accounted and document is submitted
        if (!frm.doc.journal_entry && frm.doc.docstatus === 1) {
            frm.add_custom_button(__("Create Journal Entry"), () => {
                frappe.confirm(__("Create journal entry for this expense?"), () => {
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
            }, __("Accounting"));
        }
        
        // If journal entry exists, show button to view it
        if (frm.doc.journal_entry) {
            frm.add_custom_button(__("View Journal Entry"), () => {
                frappe.set_route("Form", "Journal Entry", frm.doc.journal_entry);
            }, __("Accounting"));
        }
        
        // Button to create sales invoice if bill_to is "Tenant" and not yet invoiced
        if (frm.doc.bill_to === "Tenant" && !frm.doc.sales_invoice && frm.doc.docstatus === 1) {
            frm.add_custom_button(__("Create Tenant Invoice"), () => {
                frappe.confirm(__("Create sales invoice for the tenant?"), () => {
                    frm.call({
                        method: "create_tenant_invoice",
                        doc: frm.doc,
                        callback: function(r) {
                            if (r.message) {
                                frappe.msgprint(__("Sales Invoice {0} created", [r.message]));
                                frm.reload_doc();
                            }
                        }
                    });
                });
            }, __("Billing"));
        }
    },
    
    // Auto-calculate total amount
    amount(frm) {
        calculate_total(frm);
    },
    
    tax(frm) {
        calculate_total(frm);
    },
    
    // When bill_to changes, clear previous party selections
    bill_to(frm) {
        if (frm.doc.bill_to !== "Owner") {
            frm.set_value("owner", null);
        }
        if (frm.doc.bill_to !== "Tenant") {
            frm.set_value("tenant", null);
        }
        if (frm.doc.bill_to !== "Supplier") {
            frm.set_value("supplier", null);
        }
    },
    
    // Auto-fetch tenant from unit if available
    unit(frm) {
        if (frm.doc.unit && !frm.doc.tenant) {
            frappe.call({
                method: "nextlayer.next_layer.api.pms_dashboard.get_active_tenant_for_unit",
                args: { unit_name: frm.doc.unit },
                callback: function(r) {
                    if (r.message) {
                        frm.set_value("tenant", r.message.tenant_id);
                        frm.set_value("property", r.message.property);
                    }
                }
            });
        }
    }
});

function calculate_total(frm) {
    let amount = frm.doc.amount || 0;
    let tax = frm.doc.tax || 0;
    frm.set_value("total_amount", amount + tax);
}