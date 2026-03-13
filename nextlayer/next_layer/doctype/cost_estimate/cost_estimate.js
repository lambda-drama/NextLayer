// Copyright (c) 2026, Next Layer and contributors
// For license information, please see license.txt

frappe.ui.form.on("Cost Estimate", {
	onload: function (frm) {
		frm.set_query("cost_estimate_template", function () {
			return { filters: {} };
		});
		// Overhead cost type: only Expense accounts, optionally filtered by company
		frm.set_query("cost_type", "overheads", function () {
			const filters = { root_type: "Expense" };
			if (frm.doc.company) {
				// Restrict to accounts under the selected company
				filters["company"] = frm.doc.company;
			}
			return { filters };
		});

		// Labor expense account: only Expense accounts, optionally filtered by company
		frm.set_query("expense_account", "labor", function () {
			const filters = { root_type: "Expense" };
			if (frm.doc.company) {
				filters["company"] = frm.doc.company;
			}
			return { filters };
		});

		// Project: restrict to projects of the selected company when set
		frm.set_query("project", function () {
			const filters = {};
			if (frm.doc.company) {
				filters["company"] = frm.doc.company;
			}
			return { filters };
		});
	},
	company: function (frm) {
		// Re-apply queries when company changes so filters pick up the new company
		frm.set_query("cost_type", "overheads", function () {
			const filters = { root_type: "Expense" };
			if (frm.doc.company) {
				filters["company"] = frm.doc.company;
			}
			return { filters };
		});
		frm.set_query("expense_account", "labor", function () {
			const filters = { root_type: "Expense" };
			if (frm.doc.company) {
				filters["company"] = frm.doc.company;
			}
			return { filters };
		});
		frm.set_query("project", function () {
			const filters = {};
			if (frm.doc.company) {
				filters["company"] = frm.doc.company;
			}
			return { filters };
		});
	},
	cost_estimate_template: function (frm) {
		if (!frm.doc.cost_estimate_template) return;
		frm.call({
			method: "get_template_data",
			args: {
				template_name: frm.doc.cost_estimate_template,
				currency: frm.doc.currency,
			},
			freeze: true,
			freeze_message: __("Loading from template..."),
		}).then(function (r) {
			if (!r.message) return;
			const d = r.message;
			if (d.currency && !frm.doc.currency) frm.set_value("currency", d.currency);
			if (d.project_type && !frm.doc.project_type) frm.set_value("project_type", d.project_type);
			if (d.estimate_by) frm.set_value("estimate_by", d.estimate_by);
			if (d.company && !frm.doc.company) frm.set_value("company", d.company);
			frm.clear_table("items");
			(d.items || []).forEach(function (row) {
				const r = frm.add_child("items");
				Object.keys(row).forEach(function (k) { r[k] = row[k]; });
			});
			frm.clear_table("labor");
			(d.labor || []).forEach(function (row) {
				const r = frm.add_child("labor");
				Object.keys(row).forEach(function (k) { r[k] = row[k]; });
			});
			frm.clear_table("overheads");
			(d.overheads || []).forEach(function (row) {
				const r = frm.add_child("overheads");
				Object.keys(row).forEach(function (k) { r[k] = row[k]; });
			});
			frm.refresh_fields();
			update_cost_estimate_totals(frm);
		});
	},
	estimate_by: function (frm) {
		frm.refresh_field("items");
	},
	profit_percent: function (frm) {
		update_cost_estimate_totals(frm);
	},
	refresh: function (frm) {
		update_cost_estimate_totals(frm);
	},
});

function update_cost_estimate_totals(frm) {
	let total_material = 0;
	(frm.doc.items || []).forEach(function (row) {
		total_material += flt(row.amount, 0);
	});
	let total_labor = 0;
	(frm.doc.labor || []).forEach(function (row) {
		if (row.calculation_type === "Per Day") {
			const qty = flt(row.qty, 0) || 1;
			total_labor += qty * flt(row.days, 0) * flt(row.daily_rate, 0);
		} else {
			total_labor += flt(row.amount, 0);
		}
	});
	let total_overhead = 0;
	(frm.doc.overheads || []).forEach(function (row) {
		total_overhead += flt(row.amount, 0);
	});
	const cost_total = total_material + total_labor + total_overhead;
	const profit_pct = flt(frm.doc.profit_percent, 0) || 0;
	const selling = cost_total * (1 + profit_pct / 100);
	frm.set_value("total_material_cost", total_material);
	frm.set_value("total_labor_cost", total_labor);
	frm.set_value("overhead_cost", total_overhead);
	frm.set_value("grand_total", cost_total);
	frm.set_value("selling_price_after_profit", selling);
}

// Item: fetch rate from Item Price when item is selected; amount = qty * rate
frappe.ui.form.on("Cost Estimate Item", {
	item_code: function (frm, cdt, cdn) {
		const row = locals[cdt][cdn];
		if (row.item_code && frm.doc.currency) {
			frappe.call({
				method: "nextlayer.next_layer.doctype.cost_estimate.cost_estimate.get_item_price",
				args: { item_code: row.item_code, currency: frm.doc.currency },
				callback: function (r) {
					if (r.message != null) {
						frappe.model.set_value(cdt, cdn, "rate", r.message);
						update_estimate_item_amount(frm, cdt, cdn);
					}
				},
			});
		}
	},
	qty: function (frm, cdt, cdn) {
		update_estimate_item_amount(frm, cdt, cdn);
	},
	rate: function (frm, cdt, cdn) {
		update_estimate_item_amount(frm, cdt, cdn);
	},
});

function update_estimate_item_amount(frm, cdt, cdn) {
	const row = locals[cdt][cdn];
	row.amount = (flt(row.qty) || 0) * (flt(row.rate) || 0);
	frappe.model.set_value(cdt, cdn, "amount", row.amount);
	if (frm) update_cost_estimate_totals(frm);
}

// Labor cost: Per Day = qty × days × daily_rate; Lump Sum = amount
frappe.ui.form.on("Cost Estimate Labor", {
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
			row.qty = null;
		}
		frappe.model.set_value(cdt, cdn, row);
	},
	days: function (frm, cdt, cdn) {
		update_estimate_labor_cost(frm, cdt, cdn);
	},
	daily_rate: function (frm, cdt, cdn) {
		update_estimate_labor_cost(frm, cdt, cdn);
	},
	qty: function (frm, cdt, cdn) {
		update_estimate_labor_cost(frm, cdt, cdn);
	},
	amount: function (frm, cdt, cdn) {
		const row = locals[cdt][cdn];
		if (row.calculation_type === "Lump Sum") {
			row.cost = row.amount;
			frappe.model.set_value(cdt, cdn, "cost", row.cost);
		}
		if (frm) update_cost_estimate_totals(frm);
	},
});

function update_estimate_labor_cost(frm, cdt, cdn) {
	const row = locals[cdt][cdn];
	if (row.calculation_type === "Per Day") {
		// cost = qty × days × daily_rate (qty defaults to 1 if not set)
		const qty = flt(row.qty, 0) || 1;
		row.cost = qty * (flt(row.days) || 0) * (flt(row.daily_rate) || 0);
		frappe.model.set_value(cdt, cdn, "cost", row.cost);
	}
	if (frm) update_cost_estimate_totals(frm);
}
