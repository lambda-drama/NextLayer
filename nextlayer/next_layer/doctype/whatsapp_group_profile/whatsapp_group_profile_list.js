// Copyright (c) 2026, jr@gmail.com and contributors
// For license information, please see license.txt

// frappe.listview_settings["Whatsapp Group Profile"] = {

//     onload(listview) {

//         listview.page.add_menu_item("Sync Group Profiles", () => {

//             frappe.call({
//                 method: "nextlayer.next_layer.api.wasender_whatsapp.sync_groups",
//                 freeze: true,
//                 freeze_message: "Syncing WhatsApp groups...",
//                 callback() {
//                     listview.refresh();
//                 }
//             });

//         });

//     }

// };

// Copyright (c) 2026, jr@gmail.com and contributors
// For license information, please see license.txt

frappe.listview_settings["Whatsapp Group Profile"] = {

    onload(listview) {

        listview.page.add_inner_button("Sync Group Profiles", () => {

            frappe.call({
                method: "nextlayer.next_layer.api.wasender_whatsapp.sync_groups",
                freeze: true,
                freeze_message: "Syncing WhatsApp groups...",
                callback() {
                    listview.refresh();
                }
            });

        });

    }

};