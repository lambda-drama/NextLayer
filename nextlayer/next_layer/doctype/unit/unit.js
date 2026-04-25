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

			frm.add_custom_button(__("Create Property Expense"), () => {
				show_service_item_modal(frm);
			}, __("Expenses"));

			// Button to view all expenses for this unit
			frm.add_custom_button(__("View Expenses"), () => {
				frappe.set_route("List", "Property Expense", {
					unit: frm.doc.name
				});
			}, __("Expenses"));
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
    company(frm){
         frm.set_query("expense_account", () => {
        return {
            filters: {
                company: frm.doc.company,
                account_type: "Expense Account",
            },
        };
    });
    frm.set_query("owner_liability_account", () => {
    return {
        filters: {
            company: frm.doc.company,
            account_type: ["in", ["Liability", "Payable"]],
            is_group: 0
        },
    };
});
    }

});


function calculate_area(frm) {
    let width = frm.doc.width || 0;
    let length = frm.doc.length || 0;

    let area = width * length;
    frm.set_value('area', area);
}


// ============================================
// SERVICE ITEM SELECTION MODAL
// ============================================

function show_service_item_modal(frm) {
    const dialog = new frappe.ui.Dialog({
        title: __("Select Service / Expense Type"),
        fields: [
            {
                fieldname: "service_item",
                fieldtype: "Link",
                label: __("Service Item"),
                options: "Service Item",
                reqd: 1,
                description: __("Select the type of expense (e.g., Plumbing, Electrical, Cleaning)")
            },
            {
                fieldname: "expense_type",
                fieldtype: "Select",
                label: __("Expense Category"),
                options: "\nMaintenance\nRepair\nCleaning\nLandscaping\nUtilities\nInsurance\nProperty Tax\nManagement Fee\nLegal\nOther",
                reqd: 1,
                default: "Maintenance"
            },
            {
                fieldname: "description",
                fieldtype: "Small Text",
                label: __("Description"),
                description: __("Optional details about the expense")
            }
        ],
        primary_action_label: __("Continue"),
        primary_action: function(values) {
            // Create Property Expense with selected service item
            frappe.new_doc("Property Expense", {
                unit: frm.doc.name,
                property: frm.doc.property,
                service_item: values.service_item,
                expense_type: values.expense_type,
                description: values.description
            });
            dialog.hide();
        }
    });

    dialog.show();
}
