// Copyright (c) 2026, jr@gmail.com and contributors
// For license information, please see license.txt

frappe.ui.form.on('Tenant Contract', {
    refresh(frm) {
        // ── Active + submitted ──
        if (frm.doc.status === "Active" && frm.doc.docstatus === 1) {
            frm.add_custom_button(__("Generate Sales Invoice"), () => {
                frappe.confirm(__("Generate sales invoice(s) for this contract?"), () => {
                    frm.call("generate_sales_invoice").then(r => {
                        if (r.message) {
                            frappe.msgprint(__("Invoice {0} created successfully", [r.message]));
                            frm.reload_doc();
                        }
                    });
                });
            }, __("Actions"));

            frm.add_custom_button(__("Process Daily Utilities"), () => {
                frappe.confirm(__("Process daily utility charges for this contract?"), () => {
                    frm.call("process_daily_utilities").then(r => {
                        if (r.message && r.message.length) {
                            frappe.msgprint(__("Processed {0} utility charge(s)", [r.message.length]));
                        }
                        frm.reload_doc();
                    });
                });
            }, __("Utilities"));

            frm.add_custom_button(__("End Contract"), () => {
                frappe.confirm(__("Mark this contract as Expired?"), () => {
                    frm.call("end_contract").then(() => frm.reload_doc());
                });
            }, __("Actions"));

            frm.add_custom_button(__("Terminate Contract"), () => {
                frappe.confirm(__("Terminate this contract early?"), () => {
                    frm.call("terminate_contract").then(() => frm.reload_doc());
                });
            }, __("Actions"));
        }

        // ── Draft / Signed – allow admin activation ──
        if (frm.doc.docstatus === 0 && frm.doc.status !== "Active") {
            frm.add_custom_button(__("Activate Contract"), () => {
                frappe.confirm(
                    __("Manually activate this contract? This bypasses the signature requirement."),
                    () => {
                        frm.call("activate_contract").then(() => frm.reload_doc());
                    }
                );
            }, __("Actions"));
        }
    },

    // Auto-populate unit details when unit is selected
    unit(frm) {
        if (frm.doc.unit) {
            frappe.db.get_doc("Unit", frm.doc.unit).then(unit => {
                if (unit) {
                    frm.set_value("unit_area", unit.area);
                    if (!frm.doc.monthly_rent) {
                        frm.set_value("monthly_rent", unit.standard_rent);
                    }
                }
            });
        }
    },

    // Filter units to show only those belonging to selected property
    property(frm) {
        frm.set_query("unit", () => ({
            filters: { property: frm.doc.property }
        }));
    }
});
