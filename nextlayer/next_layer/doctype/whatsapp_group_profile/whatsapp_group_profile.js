// Copyright (c) 2026, jr@gmail.com and contributors
// For license information, please see license.txt

frappe.ui.form.on("Whatsapp Group Profile", {
    refresh(frm) {

        frm.add_custom_button("Update Members", () => {

            frappe.call({
                method: "nextlayer.next_layer.api.wasender_whatsapp.update_group_members",
                freeze: true,
                freeze_message: "Syncing WhatsApp group members...",
                args: {
                    group_id: frm.doc.group_id
                },
                callback(r) {
                    if (r.message.success) {
                        console.log(r.message.members);
                        frappe.msgprint("Members updated");
                        frm.reload_doc();
                    }
                }
            })

        });

    }
});

frappe.listview_settings["Whatsapp Group Profile"] = {
    onload(listview) {
        console.log("Listview loaded!");  // this must appear in browser console
        frappe.show_alert("Listview loaded!");
    }
};