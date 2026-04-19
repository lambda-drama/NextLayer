// Copyright (c) 2026, jr@gmail.com and contributors
// For license information, please see license.txt
// Copyright (c) 2026, jr@gmail.com and contributors
// For license information, please see license.txt

frappe.ui.form.on('Tenant', {
    before_save: function(frm) {
        if (!frm.doc.customer) {
            // Just call the backend method - let it handle everything
            frappe.call({
                method: "create_customer_for_tenant",
                doc: frm.doc,
                callback: function(r) {
                    if (r.message) {
                        frm.set_value("customer", r.message);
                        frm.refresh_field("customer");
                    }
                }
            });
        }
    }
});

// Optional: Button on Customer form to create Tenant
frappe.ui.form.on('Customer', {
    refresh: function(frm) {
        if (!frm.doc.custom_is_tenant && frm.doc.customer_group === "Tenant") {
            frm.add_custom_button(__('Create Tenant'), function() {
                frappe.call({
                    method: "property_management.api.create_tenant_from_customer",
                    args: {
                        customer: frm.doc.name
                    },
                    callback: function(r) {
                        if (r.message) {
                            frappe.set_route("Form", "Tenant", r.message);
                        }
                    }
                });
            });
        }
    }
});