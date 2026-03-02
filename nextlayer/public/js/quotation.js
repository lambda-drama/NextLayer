frappe.ui.form.on('Quotation', {
    refresh: function(frm) {
        // Only show the button if not Final Quote
        if(frm.doc.custom_revision_type != "Final Quote") {
            frm.add_custom_button('Create Next Revision', function() {
                frappe.call({
                    method: "nextlayer.next_layer.controllers.quotation_revision.create_next_revision",
                    args: {
                        quotation_name: frm.doc.name
                    },
                    callback: function(r) {
                        if(r.message) {
                            // Redirect to new quotation
                            frappe.set_route("Form", "Quotation", r.message);
                        }
                    }
                });
            }, 'Create'); // button group
        }
    }
});