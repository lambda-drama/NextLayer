// Copyright (c) 2026, jr@gmail.com and contributors
// For license information, please see license.txt

// frappe.ui.form.on("Tenant", {
// 	refresh(frm) {

// 	},
// });
frappe.ui.form.on('Tenant', {
    // Before saving the Tenant form
    before_save: function(frm) {
        if (!frm.doc.customer) {
            // Auto-create customer if not linked
            frappe.call({
                method: "create_customer_for_tenant",
                doc: frm.doc,
                callback: function(r) {
                    if (r.message) {
                        frm.set_value("customer", r.message);
                        frappe.msgprint(__("Customer {0} created automatically", [r.message]));
                    }
                }
            });
        }
    },
    
    // Validate before submit
    validate: function(frm) {
        // Ensure customer group is "Tenant"
        if (frm.doc.customer) {
            frappe.call({
                method: "frappe.client.get",
                args: {
                    doctype: "Customer",
                    name: frm.doc.customer
                },
                callback: function(r) {
                    if (r.message && r.message.customer_group !== "Tenant") {
                        frappe.msgprint(__("Customer group must be 'Tenant'"));
                        frappe.validated = false;
                    }
                }
            });
        }
        return true;
    },
    
    // On customer selection, fetch details
    customer: function(frm) {
        if (frm.doc.customer) {
            frappe.call({
                method: "frappe.client.get",
                args: {
                    doctype: "Customer",
                    name: frm.doc.customer
                },
                callback: function(r) {
                    if (r.message) {
                        frm.set_value("tenant_name", r.message.customer_name);
                        frm.set_value("email", r.message.email_id);
                        frm.set_value("phone", r.message.mobile_no);
                        frm.set_value("customer_group", r.message.customer_group);
                        
                        // Check if customer is flagged as tenant
                        if (r.message.custom_is_tenant === 1) {
                            frappe.msgprint(__("This customer is already flagged as a tenant"));
                        }
                    }
                }
            });
        }
    },
    
    // On tenant name change, optionally update customer
    tenant_name: function(frm) {
        if (frm.doc.customer && frm.doc.tenant_name) {
            frappe.confirm(
                __('Update customer name to match tenant name?'),
                function() {
                    frappe.call({
                        method: "frappe.client.set_value",
                        args: {
                            doctype: "Customer",
                            name: frm.doc.customer,
                            fieldname: "customer_name",
                            value: frm.doc.tenant_name
                        },
                        callback: function(r) {
                            frappe.msgprint(__("Customer name updated"));
                        }
                    });
                }
            );
        }
    }
});

// Helper function for bulk tenant creation from Customer list
frappe.ui.form.on('Customer', {
    // Add button on Customer form to "Make Tenant"
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
                            frappe.msgprint(__("Tenant created successfully"));
                        }
                    }
                });
            }, __('Create'));
        }
    }
});