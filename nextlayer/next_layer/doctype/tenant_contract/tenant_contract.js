// Copyright (c) 2026, jr@gmail.com and contributors
// For license information, please see license.txt

frappe.ui.form.on('Tenant Contract', {
    refresh(frm) {
        // ── Active + submitted ──
        if (frm.doc.status === "Active" && frm.doc.docstatus === 1) {
            frm.add_custom_button(__("Generate Sales Invoice"), () => {
                show_invoice_modal(frm);
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
    },

    party_name(frm){
        if (frm.doc.party_name) {
            frappe.db.get_doc("Tenant", frm.doc.party_name).then(tenant => {
                if (tenant) {
                    frm.set_value("party_name_", tenant.tenant_name);
                }
            });
        }
    },

    validate(frm){
        if (!frm.doc.proceed_without_guarantors && frm.doc.guarantors.length < 1) {
            frappe.throw("At least one guarantor is required.");
        }
    },
});

// ============================================
// SIMPLE INVOICE MODAL
// ============================================

function show_invoice_modal(frm) {
    const dialog = new frappe.ui.Dialog({
        title: __("Generate Invoices"),
        fields: [
            {
                fieldname: "start_date",
                fieldtype: "Date",
                label: __("Start Date"),
                reqd: 1,
                onchange: function() {
                    update_end_date_and_months(dialog);
                }
            },
            {
                fieldname: "number_of_months",
                fieldtype: "Int",
                label: __("Number of Months"),
                default: 1,
                min_value: 1,
                max_value: 12,
                reqd: 1,
                onchange: function() {
                    update_end_date_and_months(dialog);
                }
            },
            {
                fieldname: "end_date",
                fieldtype: "Date",
                label: __("End Date"),
                read_only: 1,
                description: __("Auto-calculated based on start date + months")
            },
            {
                fieldname: "preview",
                fieldtype: "HTML",
                label: __("Preview"),
                description: __("Months that will be generated")
            }
        ],
        primary_action_label: __("Generate"),
        primary_action: function(values) {
            generate_invoices(frm, dialog, values);
        }
    });

    dialog.show();
}

function update_end_date_and_months(dialog) {
    const start_date = dialog.get_value("start_date");
    const months = dialog.get_value("number_of_months") || 1;
    
    if (!start_date) return;
    
    // Calculate end date
    let date = frappe.datetime.str_to_obj(start_date);
    let endDate = new Date(date);
    endDate.setMonth(endDate.getMonth() + months);
    endDate.setDate(endDate.getDate() - 1);
    
    const end_date = frappe.datetime.obj_to_str(endDate);
    dialog.set_value("end_date", end_date);
    
    // Build preview
    let preview_html = `<div class="form-message" style="margin-top: 10px;">
                            <strong>Will generate ${months} invoice(s):</strong><br><br>
                            <ul style="margin-bottom: 0;">`;
    
    let current = new Date(date.getFullYear(), date.getMonth(), 1);
    for (let i = 0; i < months; i++) {
        const month_name = current.toLocaleString('default', { month: 'long' });
        const year = current.getFullYear();
        const period_end = new Date(year, current.getMonth() + 1, 0);
        
        preview_html += `<li><strong>${month_name} ${year}</strong> (${frappe.datetime.obj_to_str(current)} to ${frappe.datetime.obj_to_str(period_end)})</li>`;
        
        current.setMonth(current.getMonth() + 1);
    }
    
    preview_html += `</ul></div>`;
    dialog.get_field("preview").set_value(preview_html);
}

function generate_invoices(frm, dialog, values) {
    const start_date = values.start_date;
    const months = values.number_of_months;
    
    if (!start_date) {
        frappe.msgprint(__("Please select a start date"));
        return;
    }
    
    if (!months || months < 1) {
        frappe.msgprint(__("Please enter number of months (minimum 1)"));
        return;
    }
    
    frappe.confirm(
        __("Generate {0} invoice(s) starting from {1}?", [months, start_date]),
        () => {
            frappe.call({
                method: "generate_invoices_bulk",
                doc: frm.doc,
                args: {
                    start_date: start_date,
                    months: months
                },
                callback: function(r) {
                    if (r.message) {
                        frappe.msgprint(__("{0} invoice(s) created successfully", [r.message.length]));
                        frm.reload_doc();
                    }
                },
                error: function(err) {
                    frappe.msgprint(__("Error: {0}", [err]));
                }
            });
            dialog.hide();
        }
    );
}