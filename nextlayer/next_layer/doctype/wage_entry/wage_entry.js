// Copyright (c) 2026, jr@gmail.com and contributors
// For license information, please see license.txt

frappe.ui.form.on("Wage Entry", {
	refresh: function (frm) {
		update_wage_totals(frm);
		create_journal(frm);
		apply_filters(frm);
        if (frm.doc.docstatus >= 0 && frappe.user.has_role("WhatsApp User")) {
			frm.add_custom_button(
				__("Send WhatsApp"),
				() => open_whatsapp_dialog(frm),
				__("Actions")
			);
		}
	},

    add_type_of_work: function (frm) {
        open_work_type_modal(frm);
    },
     default_payable_account: function (frm) {
    frm.set_query("party_type", function () {
      return {
        query: "erpnext.setup.doctype.party_type.party_type.get_party_type",
        filters: {
          account: frm.doc.default_payable_account,
        },
      };
    });
  },
});

frappe.ui.form.on("Wage Breakdown Detail", {
	qty: function (frm, cdt, cdn) {
		update_wage_row_amount(frm, cdt, cdn);
	},
	rate: function (frm, cdt, cdn) {
		update_wage_row_amount(frm, cdt, cdn);
	},
});

function update_wage_row_amount(frm, cdt, cdn) {
	const row = locals[cdt][cdn];
	const qty = flt(row.qty, 0);
	const rate = flt(row.rate, 0);
	row.amount = qty * rate;
	frappe.model.set_value(cdt, cdn, "amount", row.amount);
	update_wage_totals(frm);
}

function update_wage_totals(frm) {
	let total_qty = 0;
	let total_amount = 0;
	(frm.doc.wages || []).forEach(function (row) {
		const qty = flt(row.qty, 0);
		const rate = flt(row.rate, 0);
		const amount = flt(row.amount, 0) || qty * rate;
		total_qty += qty;
		total_amount += amount;
	});
	frm.set_value("total_qty", total_qty);
	frm.set_value("total_amount", total_amount);
}

function apply_filters(frm){
	frm.set_query('default_expense_account', function() {
            return {
                filters: {
                    account_type: 'Expense Account',
                    company: frm.doc.company,
                    is_group: 0
                }
            };
        });

        // Filter payable account
        frm.set_query('default_payable_account', function() {
            return {
                filters: {
                    account_type: ['in', ['Payable', 'Cash']],
                    company: frm.doc.company,
                    is_group: 0
                }
            };
        });

         frm.set_query("payment_account", () => {
    return {
      filters: {
        company: frm.doc.company,
        // account_currency: frm.doc.currency,
        account_type: ["in", ["Cash", "Bank"]],
      },
    };
  });

   frm.set_query("cost_center", function () {
      return {
        filters: {
          company: frm.doc.company,
          is_group: 0,
        },
      };
    });
}
function create_journal(frm) {
    if (frm.doc.docstatus !== 1) return;

    frm.add_custom_button(__('Journal Entry'), function () {

        const already_paid = frm.doc.total_paid || 0;
        const remaining    = (frm.doc.total_amount || 0) - already_paid;

        let d = new frappe.ui.Dialog({
            title: __('Create Wage Payment Journal Entry'),
            fields: [
                {
                    fieldname:  'amount',
                    fieldtype:  'Currency',
                    label:      __('Amount to Pay'),
                    default:    remaining > 0 ? remaining : (frm.doc.total_amount || 0),
                    reqd:       1,
                    description: __('Total: {0} | Already Paid: {1} | Remaining: {2}', [
                        format_currency(frm.doc.total_amount, frm.doc.currency),
                        format_currency(already_paid, frm.doc.currency),
                        format_currency(remaining, frm.doc.currency),
                    ]),
                },
            ],
            primary_action_label: __('Create & Submit'),
            primary_action(values) {
                if (values.amount <= 0) {
                    frappe.msgprint(__('Amount must be greater than zero.'));
                    return;
                }

                frappe.call({
                    method:   'nextlayer.next_layer.doctype.wage_entry.wage_entry.make_journal_entry',
                    args: {
                        wage_entry_name: frm.doc.name,
                        amount:          values.amount,
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

    }, __('Create'));


        // Show link if already booked
        if (frm.doc.journal_entry) {
            frm.add_custom_button('View Journal Entry', function() {
                frappe.set_route('Form', 'Journal Entry', frm.doc.journal_entry);
            }, 'View');
        }
    }

 

function open_work_type_modal(frm) {
    // Step 1 — ask how many work types
    frappe.prompt([
        {
            fieldtype: 'Int',
            fieldname: 'num_types',
            label: 'How many types of work?',
            reqd: 1,
            default: 1
        }
    ], function(vals) {
        let count = parseInt(vals.num_types);
        if (!count || count < 1) return;
        open_work_entry_modal(frm, count);
    }, 'Work Types', 'Next');
}

function open_work_entry_modal(frm, count) {
    let fields = [];

    for (let i = 1; i <= count; i++) {
        fields.push({
            fieldtype: 'Section Break',
            label: 'Work Type ' + i,
            collapsible: 0
        });
        fields.push({
            fieldtype: 'Link',
            fieldname: 'type_of_work_' + i,
            label: 'Type of Work',
            options: 'Activity Type',
            reqd: 1
        });
        fields.push({
            fieldtype: 'Small Text',
            fieldname: 'description_' + i,
            label: 'Description'
        });
        fields.push({
            fieldtype: 'Table',
            fieldname: 'workers_' + i,
            label: 'Workers',
            options: 'Wage Breakdown Detail',
            fields: [
                {
                    fieldtype: 'Data',
                    fieldname: 'name1',
                    label: 'Name',
                    in_list_view: 1,
                    reqd: 1,
                    columns: 3
                },
                {
                    fieldtype: 'Currency',
                    fieldname: 'rate',
                    label: 'Rate',
                    in_list_view: 1,
                    reqd: 1,
                    columns: 2
                },
                {
                    fieldtype: 'Int',
                    fieldname: 'qty',
                    label: 'Qty',
                    in_list_view: 1,
                    default: 1,
                    columns: 1
                },
                {
                    fieldtype: 'Currency',
                    fieldname: 'amount',
                    label: 'Amount',
                    in_list_view: 1,
                    read_only: 1,
                    columns: 2
                },
                {
                    fieldtype: 'Data',
                    fieldname: 'phone_no',
                    label: 'Phone No'
                },
                {
                    fieldtype: 'Datetime',
                    fieldname: 'checkin',
                    label: 'Check In'
                },
                {
                    fieldtype: 'Datetime',
                    fieldname: 'checkout',
                    label: 'Check Out'
                }
            ]
        });
    }

    let d = new frappe.ui.Dialog({
        title: 'Add Work Types & Workers',
        size: 'extra-large',
        fields: fields,
        primary_action_label: 'Save to Wage Entry',
        primary_action: function(values) {
            save_to_wage_entry(frm, values, count);
            d.hide();
        }
    });

    d.show();

    // ✅ Correct way — hook into each grid's fields_dict after dialog is shown
    for (let i = 1; i <= count; i++) {
        let table_field = d.fields_dict['workers_' + i];
        if (!table_field) continue;

        // Override rate and qty fields inside the grid to trigger amount calc
        table_field.grid.wrapper.on('change', 'input, select', function() {
            table_field.grid.data.forEach(function(row) {
                let rate = parseFloat(row.rate) || 0;
                let qty  = parseInt(row.qty)   || 1;
                let calculated = rate * qty;
                if (row.amount !== calculated) {
                    row.amount = calculated;
                }
            });
            table_field.grid.refresh();
        });
    }
}

function save_to_wage_entry(frm, values, count) {
    let groups_added  = 0;
    let workers_added = 0;

    for (let i = 1; i <= count; i++) {
        let type_of_work = values['type_of_work_' + i];
        let description = values['description_' + i]
        let workers      = values['workers_' + i] || [];

        if (!type_of_work) continue;

        // Add work group row
        let existing_group = (frm.doc.work_groups || []).find(
            g => g.type_of_work === type_of_work
        );

        if (!existing_group) {
            let group_total = workers.reduce(function(sum, w) {
                return sum + ((parseFloat(w.rate) || 0) * (parseInt(w.qty) || 1));
            }, 0);

            // ✅ Use frappe.model.add_child instead of frm.add_child
            let new_group = frappe.model.add_child(frm.doc, 'Wage Work Group', 'work_groups');
            new_group.type_of_work = type_of_work;
            new_group.total_amount = group_total;
            groups_added++;
        }

        // Add worker rows
        workers.forEach(function(worker) {
            if (!worker.name1) return;

            let new_wage = frappe.model.add_child(frm.doc, 'Wage Breakdown Detail', 'wages');
            new_wage.work_group   = type_of_work;
            new_wage.type_of_work = type_of_work;
            new_wage.description = description;
            new_wage.name1        = worker.name1;
            new_wage.rate         = parseFloat(worker.rate)  || 0;
            new_wage.qty          = parseInt(worker.qty)     || 1;
            new_wage.amount       = (parseFloat(worker.rate) || 0) * (parseInt(worker.qty) || 1);
            new_wage.phone_no     = worker.phone_no || '';
            new_wage.checkin      = worker.checkin  || '';
            new_wage.checkout     = worker.checkout || '';
            workers_added++;
        });
    }

    calculate_group_totals(frm);

    frm.refresh_field('work_groups');
    frm.refresh_field('wages');
    frm.dirty();

    frappe.show_alert({
        message: groups_added + ' work type(s) and ' + workers_added + ' worker(s) added.',
        indicator: 'green'
    }, 5);
}

function calculate_group_totals(frm) {
    (frm.doc.work_groups || []).forEach(function(group) {
        let total = 0;
        (frm.doc.wages || []).forEach(function(wage) {
            if (wage.work_group === group.type_of_work) {
                total += (wage.amount || 0);
            }
        });
        frappe.model.set_value(group.doctype, group.name, 'total_amount', total);
    });

    let grand_total = (frm.doc.work_groups || []).reduce(
        (sum, g) => sum + (g.total_amount || 0), 0
    );
    frm.set_value('total_amount', grand_total);
}

function set_queries(frm) {
    frm.set_query('default_expense_account', function() {
        return {
            filters: {
                account_type: 'Expense',
                company: frm.doc.company,
                is_group: 0
            }
        };
    });

    frm.set_query('default_payable_account', function() {
        return {
            filters: {
                account_type: ['in', ['Payable', 'Cash']],
                company: frm.doc.company,
                is_group: 0
            }
        };
    });
}

function render_accounting_buttons(frm) {
    if (frm.doc.docstatus === 1 && !frm.doc.journal_entry) {
        frm.add_custom_button('Book Journal Entry', function() {
            frappe.confirm(
                'Create Journal Entry for <b>' + frm.doc.name + '</b>?',
                function() {
                    frappe.call({
                        method: 'next_layer.next_layer.doctype.wage_entry.wage_entry.make_journal_entry',
                        args: { wage_entry_name: frm.doc.name },
                        freeze: true,
                        freeze_message: 'Creating Journal Entry...',
                        callback: function(r) {
                            if (r.message) {
                                frappe.show_alert({
                                    message: 'Journal Entry ' + r.message + ' created and submitted.',
                                    indicator: 'green'
                                }, 5);
                                frm.reload_doc();
                            }
                        }
                    });
                }
            );
        }, 'Create');
    }

    if (frm.doc.journal_entry) {
        frm.add_custom_button('View Journal Entry', function() {
            frappe.set_route('Form', 'Journal Entry', frm.doc.journal_entry);
        }, 'Accounting');
    }
}



function open_whatsapp_dialog(frm) {
	// Fetch only groups the current user is permitted to access
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
				value: g.name,   // doc name (primary key) used when calling send
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
						label: __("Attach Wage Entry Document (PDF)"),
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
					// Resolve label → doc name
					const selected = group_options.find((o) => o.label === values.group);
					const group_name = selected ? selected.value : values.group;
 
					d.hide();
					frappe.show_progress(__("Sending..."), 0, 100, __("Sending WhatsApp message..."));
 
					frappe.call({
						method: "nextlayer.next_layer.api.wasender_whatsapp.send_whatsapp_from_wage_entry",
						args: {
							wage_entry_name: frm.doc.name,
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
	const full_name = user_info?.full_name 
		|| user_info?.fullname 
		|| frappe.boot.full_name 
		|| user;
    let msg = `*Wage Entry: ${doc.name}*\n`;
	if (doc.date) msg += `Date: ${doc.date}\n`;
	if (doc.wage_type) msg += `Type: ${doc.wage_type}\n`;
	if (doc.project) msg += `Project: ${doc.project}\n`;
	if (doc.stage) msg += `Stage: ${doc.stage}\n`;
	if (doc.total_amount) msg += `Total Amount: ${format_currency(doc.total_amount, doc.currency)}\n`;

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
 