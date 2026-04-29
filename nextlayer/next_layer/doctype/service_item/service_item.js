// Copyright (c) 2026, jr@gmail.com and contributors
// For license information, please see license.txt

frappe.ui.form.on("Service Item", {
	
        company(frm){
         frm.set_query("expense_account", () => {
        return {
            filters: {
                company: frm.doc.company,
                account_type: "Expense Account",
            },
        };
    });
    frm.set_query("liability_account", () => {
    return {
        filters: {
            company: frm.doc.company,
            account_type: ["in", ["Liability", "Payable"]],
            is_group: 0
        },
    };
});

 frm.set_query("income_account", () => {
    return {
        filters: {
            company: frm.doc.company,
            account_type: ["in", ["Income", "Receivable"]],
            is_group: 0
        },
    };
});
    }
});
