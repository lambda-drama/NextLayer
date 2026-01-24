// Copyright (c) 2026, Next Layer and contributors
// For license information, please see license.txt

frappe.listview_settings['WhatsApp Message Templates'] = {
	
	onload: function(listview) {
		// Add "Sync from Meta" button to the toolbar
		listview.page.add_inner_button(__("Sync from Meta"), function() {
			frappe.call({
				method: "nextlayer.next_layer.doctype.whatsapp_message_templates.whatsapp_message_templates.fetch",
				freeze: true,
				freeze_message: __("Fetching templates from Meta..."),
				callback: function(r) {
					if (!r.exc) {
						frappe.show_alert({
							message: __("Templates synced successfully from Meta."),
							indicator: "green"
						}, 5);
						listview.refresh();
					}
				},
				error: function(r) {
					frappe.show_alert({
						message: __("Failed to sync templates: {0}", [r.message || "Unknown error"]),
						indicator: "red"
					}, 10);
				}
			});
		});
	}
};
