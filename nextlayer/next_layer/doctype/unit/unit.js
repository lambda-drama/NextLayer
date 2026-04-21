// Copyright (c) 2026, jr@gmail.com and contributors
// For license information, please see license.txt

// frappe.ui.form.on("Unit", {
// 	refresh(frm) {

// 	},
// });

frappe.ui.form.on('Unit', {
    refresh(frm) {
        // Button for occupied units only
        if (frm.doc.status === "Occupied") {
            
            frm.add_custom_button(__("Generate Sales Invoice"), () => {
                frappe.confirm(__("Generate sales invoice for this unit?"), () => {
                    frm.call("generate_sales_invoice").then(r => {
                        if (r.message) {
                            frappe.msgprint(__("Invoice {0} created successfully", [r.message]));
                            frm.reload_doc();
                        }
                    });
                });
            }, __("Actions"));
        }
        
        // Button to view current contract
        if (frm.doc.current_contract) {
            frm.add_custom_button(__("View Current Contract"), () => {
                frappe.set_route("Form", "Tenant Contract", frm.doc.current_contract);
            }, __("Contracts"));
        }
        
        // Button to create new contract
        if (frm.doc.is_occupied === 0 && frm.doc.status === "Active") {
            frm.add_custom_button(__("Create Contract"), () => {
                frappe.new_doc("Tenant Contract", {
                    unit: frm.doc.name,
                    property: frm.doc.property
                });
            }, __("Contracts"));
        }
    },
    
    property(frm) {
        if (frm.doc.property) {
            // Fetch property details
            frappe.call({
                method: "frappe.client.get",
                args: { doctype: "Property", name: frm.doc.property },
                callback: function(r) {
                    if (r.message) {
                        frm.set_value("property_address", r.message.address);
                    }
                }
            });
        }
    }
});

