// Copyright (c) 2025, jr@gmail.com and contributors
// For license information, please see license.txt

frappe.ui.form.on("WhatsApp Chat", {
	refresh(frm) {
		// Add "Reply" button for incoming messages
		if (frm.doc.type === "Incoming" && frm.doc.from) {
			frm.add_custom_button(__("Reply"), function() {
				open_reply_form(frm);
			}, __("Actions"));
		}

		// Add "Send" button for outgoing messages
		// Show Send button if:
		// 1. Document is new (not saved yet), OR
		// 2. Document is saved but status is not "Success" (hasn't been sent successfully)
		if (frm.doc.type === "Outgoing") {
			const canSend = frm.doc.__islocal || !frm.doc.message_id || frm.doc.status !== "Success";
			
			if (canSend) {
				frm.add_custom_button(__("Send"), function() {
					send_whatsapp_message(frm);
				}, __("Actions"));
			}
		}
	}
});

function open_reply_form(frm) {
	// Open a new WhatsApp Chat form with reply information pre-filled
	frappe.route_options = {
		type: "Outgoing",
		to: frm.doc.from,
		is_reply: 1,
		reply_to_message_id: frm.doc.message_id,
		content_type: "text"
	};
	frappe.new_doc("WhatsApp Chat");
}

function send_whatsapp_message(frm) {
	// Validate required fields
	if (!frm.doc.to) {
		frappe.msgprint(__("Please enter the recipient phone number (TO field)"));
		frm.set_focus("to");
		return;
	}

	if (!frm.doc.message && !frm.doc.template) {
		frappe.msgprint(__("Please enter a message or select a template"));
		if (!frm.doc.template) {
			frm.set_focus("message");
		} else {
			frm.set_focus("template");
		}
		return;
	}

	if (frm.doc.use_template && !frm.doc.template) {
		frappe.msgprint(__("Please select a template"));
		frm.set_focus("template");
		return;
	}

	// Save the document first if it's new
	let save_promise = Promise.resolve();
	if (frm.doc.__islocal) {
		save_promise = frm.save();
	}

	// Show loading indicator
	frappe.show_progress(__("Sending"), 50, __("Sending WhatsApp message..."));

	// Wait for save to complete, then send
	save_promise.then(() => {
		// Call the backend API to send the message
		frappe.call({
			method: "nextlayer.next_layer.api.whatsapp_utils.send_whatsapp_from_chat",
			args: {
				chat_name: frm.doc.name
			},
			callback: function(r) {
				frappe.hide_progress();
				
				if (r.message && r.message.success) {
					// Reload the document to get updated values
					frm.reload_doc().then(() => {
						frappe.show_alert({
							message: __("WhatsApp message sent successfully"),
							indicator: "green"
						}, 5);
					});
				} else {
					// Show error message
					const error_msg = r.message && r.message.error 
						? r.message.error 
						: __("Failed to send WhatsApp message");
					
					frappe.show_alert({
						message: error_msg,
						indicator: "red"
					}, 10);
					
					// Reload to get updated status
					frm.reload_doc();
					
					// Log error details if available
					if (r.message && r.message.error_details) {
						console.error("WhatsApp send error details:", r.message.error_details);
					}
				}
			},
			error: function(r) {
				frappe.hide_progress();
				frappe.show_alert({
					message: __("Error sending WhatsApp message: {0}", [r.message || "Unknown error"]),
					indicator: "red"
				}, 10);
				frm.reload_doc();
			}
		});
	}).catch((error) => {
		frappe.hide_progress();
		frappe.show_alert({
			message: __("Error saving document: {0}", [error.message || "Unknown error"]),
			indicator: "red"
		}, 10);
	});
}
