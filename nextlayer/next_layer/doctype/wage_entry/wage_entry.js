// Copyright (c) 2026, jr@gmail.com and contributors
// For license information, please see license.txt

frappe.ui.form.on("Wage Entry", {
	refresh: function (frm) {
		update_wage_totals(frm);
		create_journal(frm);
		apply_filters(frm);
	},
});

frappe.ui.form.on("Wage Breakdown Detail", {
	qty: function (frm, cdt, cdn) {
		update_wage_row_amount(frm, cdt, cdn);
	},
	rate: function (frm, cdt, cdn) {
		update_wage_row_amount(frm, cdt, cdn);
	},
});

function update_wage_row_amount(frm, cdt, cdn) {
	const row = locals[cdt][cdn];
	const qty = flt(row.qty, 0);
	const rate = flt(row.rate, 0);
	row.amount = qty * rate;
	frappe.model.set_value(cdt, cdn, "amount", row.amount);
	update_wage_totals(frm);
}

function update_wage_totals(frm) {
	let total_qty = 0;
	let total_amount = 0;
	(frm.doc.wages || []).forEach(function (row) {
		const qty = flt(row.qty, 0);
		const rate = flt(row.rate, 0);
		const amount = flt(row.amount, 0) || qty * rate;
		total_qty += qty;
		total_amount += amount;
	});
	frm.set_value("total_qty", total_qty);
	frm.set_value("total_amount", total_amount);
}

function apply_filters(frm){
	frm.set_query('default_expense_account', function() {
            return {
                filters: {
                    account_type: 'Expense Account',
                    company: frm.doc.company,
                    is_group: 0
                }
            };
        });

        // Filter payable account
        frm.set_query('default_payable_account', function() {
            return {
                filters: {
                    account_type: ['in', ['Payable', 'Cash']],
                    company: frm.doc.company,
                    is_group: 0
                }
            };
        });
}
function create_journal(frm) {
        if (frm.doc.docstatus === 1 && !frm.doc.journal_entry) {
            frm.add_custom_button('Book Journal Entry', function() {
                frappe.confirm(
                    'Create Journal Entry for <b>' + frm.doc.name + '</b>?',
                    function() {
                        frappe.call({
                            method: 'nextlayer.next_layer.doctype.wage_entry.wage_entry.make_journal_entry',
                            args: { wage_entry_name: frm.doc.name },
                            freeze: true,
                            freeze_message: 'Creating Journal Entry...',
                            callback: function(r) {
                                if (r.message) {
                                    frappe.show_alert({
                                        message: 'Journal Entry ' + r.message + ' created and submitted.',
                                        indicator: 'green'
                                    }, 5);
                                    frm.reload_doc();
                                }
                            }
                        });
                    }
                );
            }, 'Accounting');
        }

        // Show link if already booked
        if (frm.doc.journal_entry) {
            frm.add_custom_button('View Journal Entry', function() {
                frappe.set_route('Form', 'Journal Entry', frm.doc.journal_entry);
            }, 'Accounting');
        }
    }
