// Copyright (c) 2026, jr@gmail.com and contributors
// For license information, please see license.txt

frappe.ui.form.on("Wage Entry", {
	refresh: function (frm) {
		update_wage_totals(frm);
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
