

// Client Script: JS
frappe.ui.form.on("Sales Shipment Cost", {
	refresh: function(frm){
		frappe.throw(" I am here")
	},
})

frappe.ui.form.on("Sales Landed Cost Taxes and Charges", {
	refresh: function(frm){
		frappe.throw(" I am here")
	},
    expense_account: function (frm, cdt, cdn) {
        let row = locals[cdt][cdn];
		frappe.throw("Uko")
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
