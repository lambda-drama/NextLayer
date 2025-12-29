// // Copyright (c) 2025, jr@gmail.com and contributors
// // For license information, please see license.txt

// frappe.ui.form.on("Sales Shipment Cost", {
// 	refresh(frm) {
// 		console.log("Sales Shipment Cost refresh event fired", frm.doc.name);
// 		// Add Repost Ledgers button - only visible to System Manager and Admin
// 		// Only show if document is submitted and user has permission
// 		if (frm.doc.docstatus === 1 && (frappe.user_roles.includes("System Manager") || frappe.user_roles.includes("Administrator"))) {
			
// 			// Check if GL entries exist for this Sales Shipment Cost
// 			frappe.call({
// 				method: "nextlayer.next_layer.controllers.sales_shipment.check_gl_entries_exist",
// 				args: {
// 					docname: frm.doc.name
// 				},
// 				callback: function(r) {
// 					// Only show button if GL entries don't exist
// 					if (r.message && !r.message.exists) {
// 						frm.add_custom_button(__("Repost Ledgers"), function() {
// 							repost_gl_entries(frm);
// 						}, __("Actions"));
// 					}
// 				}
// 			});
// 		}
// 	},
// })


// function repost_gl_entries(frm) {
// 	frappe.confirm(
// 		__("Are you sure you want to repost GL entries for this Sales Shipment Cost? This will delete existing GL entries and recreate them."),
// 		function() {
// 			// Yes
// 			frappe.call({
// 				method: "nextlayer.next_layer.controllers.sales_shipment.repost_gl_entries",
// 				args: {
// 					docname: frm.doc.name
// 				},
// 				freeze: true,
// 				freeze_message: __("Reposting GL entries..."),
// 				callback: function(r) {
// 					if (r.message && r.message.success) {
// 						frappe.show_alert({
// 							message: __("GL entries reposted successfully"),
// 							indicator: "green"
// 						}, 5);
// 						// Refresh the form to show updated data
// 						frm.reload_doc();
// 					}
// 				}
// 			});
// 		},
// 		function() {
// 			// No - do nothing
// 		}
// 	);
// }

// Temporarily commented out child table handler to test if it's causing issues
/*
frappe.ui.form.on("Sales Landed Cost Taxes and Charges", {
	refresh: function(frm){
		// Removed frappe.throw for debugging
	},
    expense_account: function (frm, cdt, cdn) {
        let row = locals[cdt][cdn];
        if (row.expense_account) {
            // Fetch account currency from backend
            frappe.db.get_value("Account", row.expense_account, "account_currency")
                .then(r => {
                    if (!r.message) return;
                    let account_currency = r.message.account_currency;
                    let company_currency = frm.doc.company_currency;

                    if (account_currency && account_currency !== company_currency) {
                        // Call server to get exchange rate
                        frappe.call({
                            method: "nextlayer.next_layer.utils.fetch_exchange_rate",
                            args: {
                                from_currency: account_currency,
                                to_currency: company_currency,
                                posting_date: frm.doc.posting_date
                            },
                            callback: function (res) {
                                if (res.message) {
                                    frappe.model.set_value(cdt, cdn, "exchange_rate", res.message);
                                }
                            }
                        });
                    } else {
                        frappe.model.set_value(cdt, cdn, "exchange_rate", 1);
                    }
                });
        }
    },

    amount: function (frm, cdt, cdn) {
        let row = locals[cdt][cdn];
        let company_currency = frm.doc.company_currency;

        if (row.amount && row.expense_account) {
            frappe.db.get_value("Account", row.expense_account, "account_currency")
                .then(r => {
                    if (!r.message) return;
                    let account_currency = r.message.account_currency;

                    if (account_currency && account_currency !== company_currency) {
                        let rate = row.exchange_rate || 1;
                        frappe.model.set_value(cdt, cdn, "base_amount", row.amount * rate);
                    } else {
                        frappe.model.set_value(cdt, cdn, "base_amount", row.amount);
                    }
                });
        }
    }
});
*/
