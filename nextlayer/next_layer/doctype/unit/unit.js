// Copyright (c) 2026, jr@gmail.com and contributors
// For license information, please see license.txt

frappe.ui.form.on('Unit', {
    refresh(frm) {
        if (frm.doc.status === "Occupied") {
            frm.add_custom_button(__("Generate Sales Invoice"), () => {
                frappe.confirm(__("Generate a sales invoice for this unit's active contract?"), () => {
                    frm.call("generate_sales_invoice").then(r => {
                        if (r.message) {
                            frappe.msgprint(__("Invoice {0} created successfully", [r.message]));
                            frm.reload_doc();
                        }
                    });
                });
            }, __("Actions"));
        }

        if (frm.doc.current_contract) {
            frm.add_custom_button(__("View Current Contract"), () => {
                frappe.set_route("Form", "Tenant Contract", frm.doc.current_contract);
            }, __("Contracts"));
        }

        if (!frm.doc.is_occupied && frm.doc.status === "Available") {
            frm.add_custom_button(__("Create Contract"), () => {
                frappe.new_doc("Tenant Contract", {
                    unit: frm.doc.name,
                    property: frm.doc.property,
                    monthly_rent: frm.doc.standard_rent
                });
            }, __("Contracts"));
        }
    },

    property(frm) {
        if (frm.doc.property) {
            frappe.call({
                method: "frappe.client.get",
                args: { doctype: "Property", name: frm.doc.property },
                callback(r) {
                    if (r.message && r.message.address) {
                        frm.set_value("property_address", r.message.address);
                    }
                }
            });
        }
    },

    width(frm) {
        calculate_area(frm);
    },
    
    length(frm) {
        calculate_area(frm);
    },
});


function calculate_area(frm) {
    let width = frm.doc.width || 0;
    let length = frm.doc.length || 0;

    let area = width * length;
    frm.set_value('area', area);
}
