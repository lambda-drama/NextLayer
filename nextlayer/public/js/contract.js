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
    },
    custom_amount: function(frm) {
        calculate_amount_per_stage(frm);
    },
    custom_stages: function(frm) {
        calculate_amount_per_stage(frm);
    },
    custom_amount_per_stage: function(frm) {
        generate_payment_terms(frm); // 🔥 THIS is the key
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

function calculate_amount_per_stage(frm) {
    let amount = frm.doc.custom_amount || 0;
    let stages = frm.doc.custom_stages || 0;

    if (stages > 0) {
        let per_stage = amount / stages;
        frm.set_value('custom_amount_per_stage', per_stage);
    } else {
        frm.set_value('custom_amount_per_stage', 0);
    }
}

function generate_payment_terms(frm) {
    let amount = frm.doc.custom_amount_per_stage || 0;
    if (!amount) return;

    amount = Number(amount).toFixed(2);

    let somali =
    "1. <b>WAJIGA 1-AAD:</b> Waxaa la bixin doonaa $" + amount + " marki ladhameyo Bilindiyada Tiirarka Foundation-ka.<br>" +
    "2. <b>WAJIGA 2-AAD:</b> Waxaa la bixin doonaa $" + amount + " marki ladhameyo Shubka Biyaanterka Iyo Tiirarka Ground Floor-ka.<br>" +
    "3. <b>WAJIGA 3-AAD:</b> Waxaa la bixin doonaa $" + amount + " marki ladhameyo Main Besment, Jaranjarada Iyo Shubka Salootada.";

let english =
    "1. <b>STAGE 1:</b> A Payment Of $" + amount + " Will Be Made After Completion Of The Foundation Columns.<br>" +
    "2. <b>STAGE 2:</b> A Payment Of $" + amount + " Will Be Made After Completion Of Ground Floor Slab And Columns.<br>" +
    "3. <b>STAGE 3:</b> A Payment Of $" + amount + " Will Be Made After Completion Of Basement, Staircase, And Roof Slab.";

    frm.set_value('custom_payment_terms_somali', somali);
    frm.set_value('custom_payment_terms', english);
}