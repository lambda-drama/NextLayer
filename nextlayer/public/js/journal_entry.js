// Copyright (c) 2026, Next Layer and contributors
// Apply account restriction from NextLayer Settings: hide travel_expense_accounts in Journal Entry
// Filters apply when company is chosen (same as standard Journal Entry), and on refresh when company already set.

function apply_account_restriction_if_company_set(frm) {
	if (!frm.doc.company) return;
	frappe.call({
		method: "nextlayer.next_layer.doctype.travel_expense_settings.travel_expense_settings.get_restricted_accounts_for_journal",
		callback: function (r) {
			if (!r.exc && r.message && Array.isArray(r.message)) {
				frm._restricted_accounts_for_journal = r.message;
			} else {
				frm._restricted_accounts_for_journal = [];
			}
			frm.set_query("account", "accounts", function (doc, cdt, cdn) {
				var out = erpnext.journal_entry.account_query(frm);
				if (frm._restricted_accounts_for_journal && frm._restricted_accounts_for_journal.length) {
					out.filters["name"] = ["not in", frm._restricted_accounts_for_journal];
				}
				return out;
			});
		}
	});
}

frappe.ui.form.on("Journal Entry", {
	company(frm) {
		apply_account_restriction_if_company_set(frm);
	},
	refresh(frm) {
		apply_account_restriction_if_company_set(frm);
	}
});
