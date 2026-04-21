// // Copyright (c) 2026, jr@gmail.com and contributors
// // For license information, please see license.txt


frappe.ui.form.on('Tenant Contract', {
    refresh(frm) {
        // Button for active contracts only
        if (frm.doc.status === "Active" && frm.doc.docstatus === 1) {
            
            // Generate Sales Invoice button
            frm.add_custom_button(__("Generate Sales Invoice"), () => {
                frappe.confirm(__("Generate sales invoice for this contract?"), () => {
                    frm.call("generate_sales_invoice").then(r => {
                        if (r.message) {
                            frappe.msgprint(__("Invoice {0} created successfully", [r.message]));
                            frm.reload_doc();
                        }
                    });
                });
            }, __("Actions"));
            
            // Process Daily Utilities button
            frm.add_custom_button(__("Process Daily Utilities"), () => {
                frappe.confirm(__("Process daily utilities for this contract?"), () => {
                    frm.call("process_daily_utilities").then(r => {
                        if (r.message) {
                            frappe.msgprint(__("Processed {0} utilities", [r.message.length]));
                            frm.reload_doc();
                        }
                    });
                });
            }, __("Utilities"));
        }
        
        // Button for draft contracts
        if (frm.doc.status === "Draft" && frm.doc.docstatus === 0) {
            frm.add_custom_button(__("Activate Contract"), () => {
                frappe.confirm(__("Activate this contract?"), () => {
                    frm.call("activate_contract").then(() => frm.reload_doc());
                });
            }, __("Actions"));
        }
    },
    
    // Property field change
    property(frm) {
        if (frm.doc.property) {
            frappe.call({
                method: "property_management.api.get_units_by_property",
                args: { property: frm.doc.property },
                callback: function(r) {
                    frm.set_query("unit", function() {
                        return {
                            filters: { property: frm.doc.property, status: "Active" }
                        };
                    });
                }
            });
        }
    },
    
    // Unit field change - auto populate
    unit(frm) {
        if (frm.doc.unit) {
            frappe.call({
                method: "frappe.client.get",
                args: { doctype: "Unit", name: frm.doc.unit },
                callback: function(r) {
                    if (r.message) {
                        frm.set_value("unit_area", r.message.area);
                        frm.set_value("monthly_rent", r.message.standard_rent);
                    }
                }
            });
        }
    }
});

