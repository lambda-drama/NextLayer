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
    },
		custom_company: function (frm){
		

		set_all_queries(frm);

		frm.trigger("get_currency_exchange");

	},
	get_currency_exchange: function (frm) {
    const company_currency = erpnext.get_currency(frm.doc.company);
    if (!company_currency) {
      return;
    }

    frappe.call({
      method: "erpnext.setup.utils.get_exchange_rate",
      args: {
        transaction_date: frm.doc.posting_date,
        from_currency: frm.doc.custom_currency,
        to_currency: company_currency,
      },
      freeze: true,
      freeze_message: __("Fetching exchange rates ..."),
      callback: function (r) {
        const exchange_rate = flt(r.message);
        if (exchange_rate != frm.doc.conversion_rate) {
          frm.set_value("custom_conversion_rate", exchange_rate);
        }
      },
    });
  },


    refresh(frm) {
		if (frm.doc.docstatus >= 0) {
			frm.add_custom_button(
				__("Send WhatsApp"),
				() => open_whatsapp_dialog(frm),
				__("Actions")
			);
		}

		render_stage_payment_button(frm);


	},

	setup: function (frm){
		set_account_query(frm);
		 set_all_queries(frm);
		frm.trigger("get_currency_exchange");
	}

});


function set_all_queries(frm) {

    // Payment Account (Cash / Bank)
    frm.set_query("custom_payment_account", () => {
        return {
            filters: {
                company: frm.doc.custom_company,
                account_type: ["in", ["Cash", "Bank"]],
            },
        };
    });

    // Expense Account
    frm.set_query("custom_expense_account", () => {
        return {
            filters: {
                company: frm.doc.custom_company,
                account_type: "Expense Account",
            },
        };
    });

	frm.set_query("custom_cost_center", function () {
      return {
        filters: {
          company: frm.doc.company,
          is_group: 0,
        },
      };
    });
}

function set_account_query(frm, acc_type = "Payable") {
  frm.set_query(
    acc_type === "Expense" ? "custom_expense_account" : "custom_payable_account",
    () => {
      return {
        filters: {
          company: frm.doc.custom_company,
          account_currency: frm.doc.custom_currency,
          account_type: acc_type === "Expense" ? "Expense Account" : "Payable",
        },
      };
    },
  );
}

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
    let stages = frm.doc.custom_stages || 0;

    if (!amount || !stages) return;

    amount = Number(amount).toFixed(2);

    let somali = "";
    let english = "";

    for (let i = 1; i <= stages; i++) {

        somali += i + ". <b>WAJIGA " + i + "-AAD:</b> Waxaa la bixin doonaa $" + amount + " marki ladhameyo marxaladda " + i + "-aad.<br>";

        english += i + ". <b>STAGE " + i + ":</b> A Payment Of $" + amount + " Will Be Made After Completion Of Stage " + i + ".<br>";
    }

    frm.set_value('custom_payment_terms_somali', somali);
    frm.set_value('custom_payment_terms', english);
}


//Whatsapp implementation for Contract

function open_whatsapp_dialog(frm) {
	frappe.call({
		method: "nextlayer.next_layer.doctype.wage_entry.wage_entry.get_allowed_whatsapp_groups",
		callback(r) {
			const groups = r.message || [];

			if (!groups.length) {
				frappe.msgprint({
					title: __("No Groups Available"),
					message: __("You do not have access to any WhatsApp groups. Please contact your administrator."),
					indicator: "orange",
				});
				return;
			}

			const group_options = groups.map((g) => ({
				label: g.group_name,
				value: g.name,
			}));

			const default_message = build_default_message(frm);

			const d = new frappe.ui.Dialog({
				title: __("Send WhatsApp Message"),
				fields: [
					{
						fieldname: "group",
						fieldtype: "Select",
						label: __("WhatsApp Group"),
						options: group_options.map((o) => o.label).join("\n"),
						reqd: 1,
					},
					{
						fieldname: "message",
						fieldtype: "Small Text",
						label: __("Message"),
						default: default_message,
						reqd: 1,
					},
					{
						fieldname: "attach_document",
						fieldtype: "Check",
						label: __("Attach Contract Document (PDF)"),
						default: 0,
					},
					{
						fieldname: "letterhead",
						fieldtype: "Check",
						label: __("Use Letterhead"),
						default: 0,
						depends_on: "eval:doc.attach_document == 1",
					},
					{
						fieldname: "custom_attachment",
						fieldtype: "Attach",
						label: __("Custom Attachment (optional)"),
					},
				],
				primary_action_label: __("Send"),
				primary_action(values) {
					const selected = group_options.find((o) => o.label === values.group);
					const group_name = selected ? selected.value : values.group;

					d.hide();
					frappe.show_progress(__("Sending..."), 0, 100, __("Sending WhatsApp message..."));

					frappe.call({
						method: "nextlayer.next_layer.api.wasender_whatsapp.send_whatsapp_from_contract",
						args: {
							contract_name: frm.doc.name,
							group_name: group_name,
							message: values.message,
							attach_document: values.attach_document ? 1 : 0,
							letterhead: values.letterhead ? 1 : 0,
							custom_attachment: values.custom_attachment || "",
						},
						callback(r) {
							frappe.hide_progress();
							if (r.message && r.message.success) {
								frappe.show_alert(
									{ message: __("WhatsApp message sent!"), indicator: "green" },
									5
								);
							} else {
								const err = (r.message && r.message.error) || __("Unknown error.");
								frappe.msgprint({
									title: __("Send Failed"),
									message: err,
									indicator: "red",
								});
							}
						},
						error() {
							frappe.hide_progress();
							frappe.msgprint({
								title: __("Error"),
								message: __("Failed to send. Check error logs."),
								indicator: "red",
							});
						},
					});
				},
			});

			d.show();
		},
	});
}

function build_default_message(frm) {
	const doc = frm.doc;
	const user = frappe.session.user;
	const user_info = frappe.boot.user_info?.[user];
	const full_name =
		user_info?.full_name || user_info?.fullname || frappe.boot.full_name || user;

	let msg = `*Contract: ${doc.name}*\n`;
	if (doc.custom_posting_date) msg += `Date: ${doc.custom_posting_date}\n`;
	if (doc.party_name) msg += `Party: ${doc.party_name}\n`;
	if (doc.custom_project) msg += `Project: ${doc.custom_project}\n`;
	if (doc.custom_stage) msg += `Stage: ${doc.custom_stage}\n`;
	if (doc.custom_company) msg += `Company: ${doc.custom_company}\n`;
	if (doc.custom_amount) msg += `Amount: ${format_currency(doc.custom_amount, doc.custom_currency)}\n`;
	if (doc.status) msg += `Status: ${doc.status}\n`;
	msg += `\nSent by: ${full_name}`;

	return msg.trim();
}

function format_currency(amount, currency) {
	if (!amount) return "0";
	const formatted = parseFloat(amount).toLocaleString(undefined, {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	});
	return currency ? `${currency} ${formatted}` : formatted;
}


function render_stage_payment_button(frm) {
    // Only on submitted documents
    if (frm.doc.docstatus !== 1) return;

    const stages_paid  = frm.doc.custom_stages_payment || 0;
    const total_stages = frm.doc.custom_stages          || 0;

    // Hide button when all stages are done
    if (stages_paid >= total_stages) return;

    frm.add_custom_button(__('Stage Payment Journal Entry'), function () {

        let d = new frappe.ui.Dialog({
            title: __('Create Stage Payment — Stage {0} of {1}', [stages_paid + 1, total_stages]),
            fields: [
                {
                    fieldname:  'stage_no',
                    fieldtype:  'Int',
                    label:      __('Stage Number'),
                    default:    stages_paid + 1,
                    read_only:  1,
                },
                {
                    fieldname:  'amount',
                    fieldtype:  'Currency',
                    label:      __('Amount'),
                    // default to per-stage amount; user can override
                    default:    frm.doc.custom_amount_per_stage || 0,
                    reqd:       1,
                },
            ],
            primary_action_label: __('Create & Submit'),
            primary_action(values) {
                frappe.call({
                    // Update this path if you place contract.py somewhere else
                    method: 'nextlayer.next_layer.api.contract.make_journal_entry',
                    args: {
                        contract_name: frm.doc.name,
                        amount:        values.amount,
                        stage_no:      values.stage_no,
                    },
                    freeze:         true,
                    freeze_message: __('Creating Journal Entry...'),
                    callback: function (r) {
                        if (r.message) {
                            frappe.show_alert({
                                message:   __('Journal Entry {0} created and submitted.', [r.message]),
                                indicator: 'green',
                            }, 6);
                            d.hide();
                            frm.reload_doc();
                        }
                    },
                });
            },
        });

        d.show();

    }, __('Create'));   // groups the button under a "Create" dropdown (same as Wage Entry)
}