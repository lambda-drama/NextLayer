frappe.ui.form.on('Contract', {
    custom_width: function(frm) {
        calculate_area(frm);
    },
    custom_length: function(frm) {
        calculate_area(frm);
    },
    custom_aream2: function(frm) {
        calculate_amount(frm);
    },
    custom_rate: function(frm) {
        calculate_amount(frm);
    }
});

function calculate_area(frm) {
    let width = frm.doc.custom_width || 0;
    let length = frm.doc.custom_length || 0;

    let area = width * length;
    frm.set_value('custom_aream2', area);
}

function calculate_amount(frm) {
    let area = frm.doc.custom_aream2 || 0;
    let rate = frm.doc.custom_rate || 0;

    let amount = area * rate;
    frm.set_value('custom_amount', amount);
}