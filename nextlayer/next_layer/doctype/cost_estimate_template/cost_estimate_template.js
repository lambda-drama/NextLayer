// Copyright (c) 2026, Next Layer and contributors
// For license information, please see license.txt

frappe.ui.form.on("Cost Estimate Template Labor", {
	calculation_type: function (frm, cdt, cdn) {
		const row = locals[cdt][cdn];
		if (row.calculation_type === "Per Day") {
			row.contractor_description = "";
			row.amount = null;
		} else {
			row.activity = "";
			row.resource_type = "";
			row.days = null;
			row.daily_rate = null;
		}
		frappe.model.set_value(cdt, cdn, row);
	},
	days: function (frm, cdt, cdn) {
		update_labor_cost(frm, cdt, cdn);
	},
	daily_rate: function (frm, cdt, cdn) {
		update_labor_cost(frm, cdt, cdn);
	},
	amount: function (frm, cdt, cdn) {
		const row = locals[cdt][cdn];
		if (row.calculation_type === "Lump Sum") {
			row.cost = row.amount;
			frappe.model.set_value(cdt, cdn, "cost", row.cost);
		}
	},
});

function update_labor_cost(frm, cdt, cdn) {
	const row = locals[cdt][cdn];
	if (row.calculation_type === "Per Day") {
		row.cost = (flt(row.days) || 0) * (flt(row.daily_rate) || 0);
		frappe.model.set_value(cdt, cdn, "cost", row.cost);
	}
}

frappe.ui.form.on("Cost Estimate Template Item", {
	qty: function (frm, cdt, cdn) {
		update_item_amount(frm, cdt, cdn);
	},
	rate: function (frm, cdt, cdn) {
		update_item_amount(frm, cdt, cdn);
	},
});

function update_item_amount(frm, cdt, cdn) {
	const row = locals[cdt][cdn];
	row.amount = (flt(row.qty) || 0) * (flt(row.rate) || 0);
	frappe.model.set_value(cdt, cdn, "amount", row.amount);
}

frappe.ui.form.on("Cost Estimate Template Item", {
	item_code: function (frm, cdt, cdn) {
		const row = locals[cdt][cdn];
		if (row.item_code && frm.doc.currency) {
			frappe.call({
				method: "nextlayer.next_layer.doctype.cost_estimate.cost_estimate.get_item_price",
				args: { item_code: row.item_code, currency: frm.doc.currency },
				callback: function (r) {
					if (r.message != null) {
						frappe.model.set_value(cdt, cdn, "rate", r.message);
						update_item_amount(frm, cdt, cdn);
					}
				},
			});
		}
	},
});
