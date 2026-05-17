// Copyright (c) 2026, jr@gmail.com and contributors
// For license information, please see license.txt

frappe.ui.form.on("PMS Settings", {
	refresh(frm) {
		frm.add_custom_button(__("Reset Units to Available"), () => {
			frappe.confirm(
				__(
					"Set every unit without an active Tenant Contract back to Available? " +
					"This clears current tenant and contract links on those units."
				),
				() => {
					frappe.call({
						method: "reset_units_without_active_contract",
						doc: frm.doc,
						freeze: true,
						freeze_message: __("Updating units…"),
						callback(r) {
							const msg = r.message || {};
							const count = msg.updated_count || 0;
							if (count) {
								frappe.msgprint({
									title: __("Units updated"),
									message: __("Reset {0} unit(s) to Available.", [count]),
									indicator: "green",
								});
							} else {
								frappe.msgprint({
									title: __("No changes"),
									message: __("All units already match their active contracts."),
									indicator: "blue",
								});
							}
						},
					});
				}
			);
		}, __("Maintenance"));
	},
});
