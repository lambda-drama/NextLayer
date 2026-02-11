// Copyright (c) 2025, Next Layer and contributors
// For license information, please see license.txt

// Track lookup status to prevent multiple simultaneous lookups
let flight_lookup_in_progress = false;

frappe.ui.form.on("Travel Expense", {
	travel_amount: function(frm) {
		convert_and_update_amount(frm);
	},
	amountcompany_currency: function(frm) {
		let amt = parseFloat(frm.doc.amountcompany_currency) || 0;
		let tx = parseFloat(frm.doc.travel_amount) || amt;
		if (amt > 0) update_category_row_amount(frm, tx, amt);
	},
	currency: function(frm) {
		convert_and_update_amount(frm);
		recalculate_all_expense_amounts_company_currency(frm);
		calculate_totals(frm);
	},
	
	company: function(frm) {
		if (frm.doc.travel_amount && frm.doc.currency) {
			convert_and_update_amount(frm);
		}
		recalculate_all_expense_amounts_company_currency(frm);
		calculate_totals(frm);
		
		// Set company filter for payable_account and direct_payment_account when company changes
		if (frm.doc.company) {
			frm.set_query("payable_account", function() {
				return {
					filters: {
						company: frm.doc.company
					}
				};
			});
			
			frm.set_query("direct_payment_account", function() {
				return {
					filters: {
						company: frm.doc.company,
						account_type: ["in", ["Bank", "Cash"]],
						is_group: 0
					}
				};
			});
			
			// Set company filter for cost_center when company changes
			frm.set_query("cost_center", function() {
				return {
					filters: {
						company: frm.doc.company
					}
				};
			});
		}
	},
	
	posting_date: function(frm) {
		if (frm.doc.travel_amount && frm.doc.currency) {
			convert_and_update_amount(frm);
		}
		recalculate_all_expense_amounts_company_currency(frm);
		calculate_totals(frm);
	},
	rate_per_day: function(frm) {
		if (frm.doc.expense_category !== "Hotel") return;
		compute_hotel_amount_and_push(frm);
	},
	hotel_checkin_date: function(frm) {
		if (frm.doc.expense_category !== "Hotel") return;
		compute_hotel_amount_and_push(frm);
	},
	hotel_checkout_date: function(frm) {
		if (frm.doc.expense_category !== "Hotel") return;
		compute_hotel_amount_and_push(frm);
	},
	
	is_paid: function(frm) {
		// Show/hide direct_payment_account and set payable_account requirement based on is_paid
		if (frm.doc.is_paid) {
			frm.set_df_property("direct_payment_account", "reqd", 1);
			frm.set_df_property("payable_account", "reqd", 0);
		} else {
			frm.set_df_property("direct_payment_account", "reqd", 0);
			frm.set_df_property("payable_account", "reqd", 1);
		}
		frm.refresh_field("direct_payment_account");
		frm.refresh_field("payable_account");
	},
	
	flight_date: function(frm) {
		// If flight number is already entered, trigger lookup with the new date
		if (frm.doc.flight_no && frm.doc.flight_no.trim() && frm.doc.flight_date) {
			if (!flight_lookup_in_progress) {
				lookup_flight_for_travel_expense(frm);
			}
		}
	},
	
	trip_type: function(frm) {
		// Clear second flight fields when not In Transit
		if (frm.doc.trip_type !== "In Transit") {
			frm.set_value("flight_no_2", "");
			frm.set_value("custom_departure_airport_2", "");
			frm.set_value("custom_arrival_airport_2", "");
			frm.set_value("custom_date_of_travel_2", "");
			frm.set_value("custom_date_of_arrival_2", "");
		} else {
			// Setup event listeners when In Transit is selected
			setup_second_flight_listeners(frm);
		}
		// Clear multi_city_segments when not Multi City
		if (frm.doc.trip_type !== "Multi City" && frm.doc.multi_city_segments && frm.doc.multi_city_segments.length) {
			frm.clear_table("multi_city_segments");
			frm.refresh_field("multi_city_segments");
		}
	},
	
	flight_no_2: function(frm) {
		// Direct field change handler for second flight number
		// Use a small delay to avoid triggering while user is still typing
		if (frm.doc.flight_no_2 && frm.doc.flight_no_2.trim() && frm.doc.trip_type === "In Transit") {
			// Clear any existing timeout
			if (frm._flight_no_2_timeout) {
				clearTimeout(frm._flight_no_2_timeout);
			}
			
			// Set a timeout to trigger lookup after user stops typing (500ms delay)
			frm._flight_no_2_timeout = setTimeout(function() {
				if (frm.doc.flight_no_2 && frm.doc.flight_no_2.trim() && frm.doc.trip_type === "In Transit") {
					if (!flight_lookup_in_progress) {
						lookup_flight_for_travel_expense_second_flight(frm);
					}
				}
			}, 500);
		}
	},
	
	validate: function(frm) {
		// Validate payable_account is mandatory when is_paid is not ticked
		if (!frm.doc.is_paid && !frm.doc.payable_account) {
			frappe.msgprint({
				title: __("Validation Error"),
				message: __("Payable Account is mandatory when 'Is Paid' is not ticked."),
				indicator: "red",
			});
			frappe.validated = false;
		}
		
		// Validate direct_payment_account is mandatory when is_paid is ticked
		if (frm.doc.is_paid && !frm.doc.direct_payment_account) {
			frappe.msgprint({
				title: __("Validation Error"),
				message: __("Direct Payment Account is mandatory when 'Is Paid' is ticked."),
				indicator: "red",
			});
			frappe.validated = false;
		}
	},
	
	refresh: function(frm) {
		// Set initial requirements based on is_paid
		// Payable account is always visible, just mandatory when is_paid is not ticked
		if (frm.doc.is_paid) {
			frm.set_df_property("direct_payment_account", "reqd", 1);
			frm.set_df_property("payable_account", "reqd", 0);
		} else {
			frm.set_df_property("direct_payment_account", "reqd", 0);
			frm.set_df_property("payable_account", "reqd", 1);
		}
		frm.refresh_field("direct_payment_account");
		frm.refresh_field("payable_account");
		
		// Set company filter for payable_account
		frm.set_query("payable_account", function() {
			if (!frm.doc.company) {
				frappe.msgprint({
					title: __("Warning"),
					message: __("Please select a Company first."),
					indicator: "orange",
				});
				return {
					filters: {}
				};
			}
			return {
				filters: {
					company: frm.doc.company
				}
			};
		});
		
		// Set company filter for cost_center
		frm.set_query("cost_center", function() {
			if (!frm.doc.company) {
				return {
					filters: {}
				};
			}
			return {
				filters: {
					company: frm.doc.company
				}
			};
		});
		calculate_totals(frm);
		
		// Add event listeners to expenses child table
		if (frm.fields_dict.expenses && frm.fields_dict.expenses.grid) {
			frm.fields_dict.expenses.grid.wrapper.on('change', function() {
				calculate_totals(frm);
			});
		}
		
		// Add event listeners to taxes_and_charges child table
		if (frm.fields_dict.taxes_and_charges && frm.fields_dict.taxes_and_charges.grid) {
			frm.fields_dict.taxes_and_charges.grid.wrapper.on('change', function() {
				calculate_totals(frm);
			});
		}
		
		// Add event listeners to flight number field for Enter key and blur
		if (frm.fields_dict.flight_no && frm.fields_dict.flight_no.$input) {
			frm.fields_dict.flight_no.$input.off('keydown blur');
			
			frm.fields_dict.flight_no.$input.on('keydown', function(e) {
				if (e.keyCode === 13) {
					e.preventDefault();
					if (frm.doc.flight_no && frm.doc.flight_no.trim()) {
						if (!flight_lookup_in_progress) {
							lookup_flight_for_travel_expense(frm);
						}
					}
				}
			});
			
			frm.fields_dict.flight_no.$input.on('blur', function() {
				if (frm.doc.flight_no && frm.doc.flight_no.trim()) {
					if (!flight_lookup_in_progress) {
						lookup_flight_for_travel_expense(frm);
					}
				}
			});
		}
		
		// Setup event listeners for second flight number
		setup_second_flight_listeners(frm);
		
		// Add "Additional Expenses" and "Cancel Charges" buttons
		if (!frm.is_new()) {
			// Only allow Additional Expenses while not cancelled
			if (!frm.doc.is_cancelled) {
				frm.add_custom_button(__("Additional Expenses"), function() {
					show_additional_expenses_modal(frm);
				}, __("Actions"));
			}
			
			// Only show Cancel Charges if document is submitted and not already cancelled
			if (frm.doc.docstatus === 1 && !frm.doc.is_cancelled) {
				frm.add_custom_button(__("Cancel Charges"), function() {
					cancel_travel_expense_charges(frm);
				}, __("Actions"));
			}
		}
	},
	
	before_save: function(frm) {
		calculate_totals(frm);
		// When Multi City: sync multi_city_segments to main expenses table (first segment = departure/PRN/dates, last = arrival)
		if (frm.doc.trip_type === "Multi City" && frm.doc.multi_city_segments && frm.doc.multi_city_segments.length > 0) {
			sync_multi_city_to_expenses(frm);
		}
		remove_expense_rows_without_type(frm);
		if (frm.doc.expenses && frm.doc.expenses.length > 0) frm.refresh_field("expenses");
		let expense_type = get_expense_type_for_charges(frm);
		if (!expense_type) return;

		// For Hotel: amount can come from travel_amount or rate_per_day * total_nights
		let amount_transaction = parseFloat(frm.doc.travel_amount) || 0;
		if (expense_type === "Hotel" && (frm.doc.rate_per_day || frm.doc.hotel_checkin_date) && (!amount_transaction || amount_transaction === 0)) {
			let total_nights = 0;
			if (frm.doc.hotel_checkin_date && frm.doc.hotel_checkout_date) {
				let checkin = new Date(frm.doc.hotel_checkin_date);
				let checkout = new Date(frm.doc.hotel_checkout_date);
				if (checkout >= checkin) {
					total_nights = Math.ceil((checkout - checkin) / (1000 * 60 * 60 * 24));
				}
			}
			let rate = parseFloat(frm.doc.rate_per_day) || 0;
			if (rate > 0 && total_nights > 0) {
				amount_transaction = rate * total_nights;
				frm.set_value("travel_amount", amount_transaction);
				frm.set_value("total_nights", total_nights);
			}
		}
		if (!amount_transaction && amount_transaction !== 0) amount_transaction = 0;
		let amount_company = parseFloat(frm.doc.amountcompany_currency) || 0;

		let count_same_type = 0;
		if (frm.doc.expenses && frm.doc.expenses.length > 0) {
			frm.doc.expenses.forEach(function(row) {
				if (row.expense_type === expense_type) count_same_type++;
			});
		}

		if (count_same_type === 0 && amount_transaction > 0) {
			let new_row = frm.add_child("expenses");
			new_row.expense_type = expense_type;
			new_row.amount = amount_transaction;
			new_row.amount_company_currency = amount_company || amount_transaction;
			new_row.sanctioned_amount = amount_company || amount_transaction;
			new_row.expense_date = frm.doc.posting_date || frappe.datetime.get_today();
			frappe.model.set_value(new_row.doctype, new_row.name, "expense_type", expense_type);
			frappe.model.set_value(new_row.doctype, new_row.name, "amount", amount_transaction);
			frappe.model.set_value(new_row.doctype, new_row.name, "amount_company_currency", amount_company || amount_transaction);
			frappe.model.set_value(new_row.doctype, new_row.name, "sanctioned_amount", amount_company || amount_transaction);
			if (frm.doc.posting_date) {
				frappe.model.set_value(new_row.doctype, new_row.name, "expense_date", frm.doc.posting_date);
			}
			if (frm.doc.company && frm.doc.currency && frm.doc.posting_date) {
				convert_expense_amount_to_company_currency(frm, new_row.doctype, new_row.name);
			}
		}

		// Sync main form details to child rows by expense type
		if (frm.doc.expenses && frm.doc.expenses.length > 0) {
			frm.doc.expenses.forEach(function(row) {
				if (row.expense_type === "Travel") {
					let field_mappings = [
						{ main: "custom_departure_airport", child: "custom_departure_airport" },
						{ main: "custom_arrival_airport", child: "custom_arrival_airport" },
						{ main: "custom_airlines", child: "custom_airlines" },
						{ main: "custom_date_of_travel", child: "custom_date_of_travel" },
						{ main: "custom_date_of_arrival", child: "custom_date_of_arrival" },
						{ main: "custom_date_of_purchase", child: "custom_date_of_purchase" },
						{ main: "custom_booked_by", child: "custom_booked_by" },
						{ main: "custom_travel_type", child: "custom_travel_type" },
						{ main: "custom_pnr_number_", child: "custom_prn_number" },
					];
					field_mappings.forEach(function(m) {
						let v = frm.doc[m.main];
						if (v && (!row[m.child] || row[m.child] === "")) {
							row[m.child] = v;
							frappe.model.set_value(row.doctype, row.name, m.child, v);
						}
					});
				}
				if (row.expense_type === "Hotel") {
					let hotel_fields = ["hotel_checkin_date", "hotel_checkout_date", "hotel_days", "custom_hotel_name", "hotel_territory", "hotel_location", "hotel_city", "hotel_country", "rate_per_day", "purpose"];
					hotel_fields.forEach(function(f) {
						let v = frm.doc[f];
						if (v !== undefined && v !== null && v !== "" && (!row[f] || row[f] === "")) {
							row[f] = v;
							frappe.model.set_value(row.doctype, row.name, f, v);
						}
					});
				}
				if (row.expense_type === expense_type) {
					if (frm.doc.travel_amount) {
						frappe.model.set_value(row.doctype, row.name, "amount", frm.doc.travel_amount);
					}
					if (frm.doc.amountcompany_currency) {
						frappe.model.set_value(row.doctype, row.name, "amount_company_currency", frm.doc.amountcompany_currency);
						frappe.model.set_value(row.doctype, row.name, "sanctioned_amount", frm.doc.amountcompany_currency);
					} else if (frm.doc.travel_amount) {
						convert_expense_amount_to_company_currency(frm, row.doctype, row.name);
						frappe.model.set_value(row.doctype, row.name, "sanctioned_amount", frm.doc.travel_amount);
					}
				}
			});
		}
	},
	
	refresh: function(frm) {
		// Calculate totals on refresh
		calculate_totals(frm);
		// Set hotel_days (Days) from checkin/checkout when Hotel section has dates
		if (frm.doc.expense_category === "Hotel" && frm.doc.hotel_checkin_date && frm.doc.hotel_checkout_date) {
			let checkin = new Date(frm.doc.hotel_checkin_date);
			let checkout = new Date(frm.doc.hotel_checkout_date);
			if (checkout >= checkin) {
				let days = Math.ceil((checkout - checkin) / (1000 * 60 * 60 * 24));
				frm.set_value("hotel_days", days);
				frm.refresh_field("hotel_days");
			}
		}
		// Accounting Details: collapsible but start collapsed (Frappe keeps it open when it has mandatory fields)
		if (frm.layout && frm.layout.sections && !frm._accounting_section_collapsed_set) {
			for (let i = 0; i < frm.layout.sections.length; i++) {
				let section = frm.layout.sections[i];
				if (section.df && section.df.fieldname === "section_break_accounting") {
					section.collapse(true);
					frm._accounting_section_collapsed_set = true;
					break;
				}
			}
		}
		// Add event listeners to expenses child table
		if (frm.fields_dict.expenses && frm.fields_dict.expenses.grid) {
			frm.fields_dict.expenses.grid.wrapper.on('change', function() {
				calculate_totals(frm);
			});
		}
		
		// Add event listeners to taxes_and_charges child table
		if (frm.fields_dict.taxes_and_charges && frm.fields_dict.taxes_and_charges.grid) {
			frm.fields_dict.taxes_and_charges.grid.wrapper.on('change', function() {
				calculate_totals(frm);
			});
		}
		
		// Add event listeners to flight number field for Enter key and blur
		if (frm.fields_dict.flight_no && frm.fields_dict.flight_no.$input) {
			// Remove existing listeners to avoid duplicates
			frm.fields_dict.flight_no.$input.off('keydown blur');
			
			// Enter key handler
			frm.fields_dict.flight_no.$input.on('keydown', function(e) {
				if (e.keyCode === 13) {
					e.preventDefault();
					if (frm.doc.flight_no && frm.doc.flight_no.trim()) {
						if (!flight_lookup_in_progress) {
							lookup_flight_for_travel_expense(frm);
						}
					}
				}
			});
			
			// Blur handler - trigger lookup when field loses focus
			frm.fields_dict.flight_no.$input.on('blur', function(e) {
				if (frm.doc.flight_no && frm.doc.flight_no.trim()) {
					if (!flight_lookup_in_progress) {
						lookup_flight_for_travel_expense(frm);
					}
				}
			});
		}
		
		// Multi City: button to fetch flight for selected segment row
		if (frm.doc.trip_type === "Multi City" && frm.fields_dict.multi_city_segments) {
			frm.add_custom_button(__("Fetch flight for segment"), function() {
				let grid = frm.fields_dict.multi_city_segments.grid;
				let segments = frm.doc.multi_city_segments || [];
				if (!segments.length) {
					frappe.msgprint(__("Add at least one row in Multi City Segments, enter Flight No and Flight Date, then click this button."));
					return;
				}
				let row = null;
				if (grid && grid.get_selected_children) {
					let selected = grid.get_selected_children();
					if (selected && selected.length > 0) {
						let s = selected[0];
						row = (s && s.doc) ? s.doc : segments.find(function(r) { return r.name === s; });
					}
				}
				if (!row && segments.length > 0) {
					row = segments[segments.length - 1];
				}
				if (!row || !(row.flight_no && row.flight_no.trim())) {
					frappe.msgprint(__("Select a segment row, enter Flight No (and Flight Date), then click 'Fetch flight for segment'."));
					return;
				}
				lookup_flight_for_multi_city_row(frm, row);
			}, __("Multi City Segments"));
			
			// Multi City: same behaviour as main form – Enter or blur on Flight No / Flight Date triggers API lookup
			let multi_city_grid = frm.fields_dict.multi_city_segments.grid;
			if (multi_city_grid && multi_city_grid.wrapper) {
				multi_city_grid.wrapper.off('keydown.multicity blur.multicity', 'input[data-fieldname="flight_no"], input[data-fieldname="flight_date"]');
				// Enter key – trigger lookup
				multi_city_grid.wrapper.on('keydown.multicity', 'input[data-fieldname="flight_no"], input[data-fieldname="flight_date"]', function(e) {
					if (e.keyCode === 13) {
						e.preventDefault();
						let row_name = $(this).closest('.grid-row').attr('data-name');
						if (row_name) {
							let row = locals['Travel Expense Multi City'] && locals['Travel Expense Multi City'][row_name];
							if (row && row.flight_no && row.flight_no.trim()) {
								lookup_flight_for_multi_city_row(frm, row);
							}
						}
					}
				});
				// Blur – trigger lookup when leaving the field (like main form)
				multi_city_grid.wrapper.on('blur.multicity', 'input[data-fieldname="flight_no"], input[data-fieldname="flight_date"]', function() {
					let $input = $(this);
					let row_name = $input.closest('.grid-row').attr('data-name');
					if (!row_name) return;
					setTimeout(function() {
						let row = locals['Travel Expense Multi City'] && locals['Travel Expense Multi City'][row_name];
						if (row && row.flight_no && row.flight_no.trim() && !flight_lookup_in_progress) {
							lookup_flight_for_multi_city_row(frm, row);
						}
					}, 100);
				});
			}
		}
		
		// Add "Additional Expenses" and "Cancel Charges" buttons after submit (only show if document is submitted)
		if (frm.doc.docstatus === 1) {
			// Only allow Additional Expenses while not cancelled
			if (!frm.doc.is_cancelled) {
				frm.add_custom_button(__("Additional Expenses"), function() {
					show_additional_expenses_modal(frm);
				}, __("Create"));
			}
			
			// Check if Journal Entry exists, and show "Create Journal" button if it doesn't
			// Use check_journal_entry_exists (read-only) to avoid creating journal on refresh
			frappe.call({
				method: "nextlayer.next_layer.api.travel_expense_utils.check_journal_entry_exists",
				args: {
					travel_expense_name: frm.doc.name
				},
				async: false,
				callback: function(r) {
					if (r.message) {
						// If no journal entry exists (or error checking), show Create Journal button
						if (!r.message.success || !r.message.already_exists) {
							if (!frm.doc.is_cancelled) {
								frm.add_custom_button(__("Journal"), function() {
									create_journal_entry_for_travel_expense(frm);
								}, __("Create"));
							}
						}
					}
				},
				error: function(r) {
					// On error, still show the button (user can try to create)
					if (!frm.doc.is_cancelled) {
						frm.add_custom_button(__("Create Journal"), function() {
							create_journal_entry_for_travel_expense(frm);
						}, __("Create"));
					}
				}
			});
			
			// Only show Cancel Charges if not already cancelled
			if (!frm.doc.is_cancelled) {
				frm.add_custom_button(__("Cancel Charges"), function() {
					cancel_travel_expense_charges(frm);
				}, __("Create"));
			}
		}
	}
});

// Handle flight lookup from child table (Travel Expense Detail)
frappe.ui.form.on("Travel Expense Detail", {
	hotel_checkin_date: function(frm, cdt, cdn) {
		let row = locals[cdt][cdn];
		if (!row || !row.expense_type || !row.expense_type.toLowerCase().includes("hotel")) return;
		if (row.hotel_checkin_date && row.hotel_checkout_date) {
			let checkin = new Date(row.hotel_checkin_date);
			let checkout = new Date(row.hotel_checkout_date);
			if (checkout >= checkin) {
				let days = Math.ceil((checkout - checkin) / (1000 * 60 * 60 * 24));
				frappe.model.set_value(cdt, cdn, "hotel_days", days);
			}
		}
	},
	hotel_checkout_date: function(frm, cdt, cdn) {
		let row = locals[cdt][cdn];
		if (!row || !row.expense_type || !row.expense_type.toLowerCase().includes("hotel")) return;
		if (row.hotel_checkin_date && row.hotel_checkout_date) {
			let checkin = new Date(row.hotel_checkin_date);
			let checkout = new Date(row.hotel_checkout_date);
			if (checkout >= checkin) {
				let days = Math.ceil((checkout - checkin) / (1000 * 60 * 60 * 24));
				frappe.model.set_value(cdt, cdn, "hotel_days", days);
			}
		}
	},
	cost_center: function(frm, cdt, cdn) {
		// Set company filter for cost_center in child table
		frm.set_query("cost_center", "expenses", function() {
			if (!frm.doc.company) {
				return {
					filters: {}
				};
			}
			return {
				filters: {
					company: frm.doc.company
				}
			};
		});
	},
	
	amount: function(frm, cdt, cdn) {
		// Get the row and preserve the amount value (transaction currency)
		let row = locals[cdt][cdn];
		if (!row) return;
		
		// Get the value the user just entered (this is in transaction currency)
		let transaction_amount = parseFloat(row.amount) || 0;
		
		// Ensure amount field stays as transaction currency (don't let it be overwritten)
		// The amount field should always be in transaction currency
		if (row.amount !== transaction_amount && transaction_amount > 0) {
			frappe.model.set_value(cdt, cdn, "amount", transaction_amount);
		}
		
		// Convert to company currency (this only updates amount_company_currency, not amount)
		convert_expense_amount_to_company_currency(frm, cdt, cdn);
		
		// Recalculate totals when amount changes
		calculate_totals(frm);
	},
	
	expenses_remove: function(frm, cdt, cdn) {
		// Recalculate totals when expense row is removed
		calculate_totals(frm);
	},
	
	refresh: function(frm) {
		// Set company filter for cost_center in child table
		frm.set_query("cost_center", "expenses", function() {
			if (!frm.doc.company) {
				return {
					filters: {}
				};
			}
			return {
				filters: {
					company: frm.doc.company
				}
			};
		});
		
		// Add event listeners to flight number field in the grid for Enter key and blur
		if (frm.fields_dict.expenses && frm.fields_dict.expenses.grid) {
			// Remove existing listeners to avoid duplicates
			frm.fields_dict.expenses.grid.wrapper.off('keydown blur', 'input[data-fieldname="custom_flight_no"]');
			
			// Enter key handler
			frm.fields_dict.expenses.grid.wrapper.on('keydown', 'input[data-fieldname="custom_flight_no"]', function(e) {
				if (e.keyCode === 13) {
					e.preventDefault();
					let row_name = $(this).closest('.grid-row').attr('data-name');
					if (row_name) {
						let row = locals['Travel Expense Detail'][row_name];
						if (row && row.custom_flight_no && row.custom_flight_no.trim()) {
							lookup_flight_for_travel_expense_detail(frm, row, row_name);
						}
					}
				}
			});
			
			// Blur handler - trigger lookup when field loses focus
			frm.fields_dict.expenses.grid.wrapper.on('blur', 'input[data-fieldname="custom_flight_no"]', function(e) {
				let row_name = $(this).closest('.grid-row').attr('data-name');
				if (row_name) {
					let row = locals['Travel Expense Detail'][row_name];
					if (row && row.custom_flight_no && row.custom_flight_no.trim()) {
						// Use a small delay to ensure the value is updated in the row
						setTimeout(function() {
							if (!flight_lookup_in_progress || flight_lookup_in_progress !== row_name) {
								lookup_flight_for_travel_expense_detail(frm, row, row_name);
							}
						}, 100);
					}
				}
			});
		}
	}
});

// More Information: Create Journal button (per row when journal_created is 0)
frappe.ui.form.on("Travel Expense More Information", "create_journal_btn", function(frm, cdt, cdn) {
	if (!frm.doc.name || frm.doc.docstatus !== 1) {
		frappe.msgprint({ title: __("Not Allowed"), message: __("Travel Expense must be submitted first."), indicator: "orange" });
		return;
	}
	let row = locals[cdt] && locals[cdt][cdn];
	if (!row || row.journal_created) {
		return;
	}
	frappe.call({
		method: "nextlayer.next_layer.api.travel_expense_utils.create_journal_for_more_information_row",
		args: { travel_expense_name: frm.doc.name, row_name: cdn },
		callback: function(r) {
			if (r.message && r.message.success) {
				frappe.show_alert(__("Journal Entry {0} created.", [r.message.journal_entry_name]), 5, "green");
				frm.reload_doc();
			} else {
				frappe.msgprint({
					title: __("Error"),
					message: r.message && r.message.error ? r.message.error : __("Failed to create journal entry."),
					indicator: "red"
				});
			}
		},
		error: function() {
			frappe.msgprint({ title: __("Error"), message: __("Failed to create journal entry."), indicator: "red" });
		}
	});
});

// Handle taxes and charges child table
frappe.ui.form.on("Sales Taxes and Charges", {
	tax_amount: function(frm, cdt, cdn) {
		// Recalculate totals when tax amount changes
		calculate_totals(frm);
	},
	
	taxes_and_charges_remove: function(frm, cdt, cdn) {
		// Recalculate totals when tax row is removed
		calculate_totals(frm);
	}
});

function lookup_flight_for_travel_expense(frm) {
	let flight_number = frm.doc.flight_no ? frm.doc.flight_no.trim() : "";
	if (!flight_number) return;
	if (flight_lookup_in_progress) return;

	// When Historical is ticked: show date-range modal, then fetch via historical API and display like normal lookup; on accept auto-fill travel fields
	if (frm.doc.historical) {
		show_historical_date_range_modal(frm, flight_number);
		return;
	}

	// Normal flow: use flight_date if entered, else raw
	let flight_date = null;
	if (frm.doc.flight_date) {
		flight_date = frappe.datetime.str_to_obj(frm.doc.flight_date);
		if (flight_date) {
			flight_date = frappe.datetime.obj_to_str(flight_date).split(" ")[0];
		}
	}
	flight_lookup_in_progress = true;
	frappe.show_alert(__("Looking up flight information..."), 3);
	frappe.call({
		method: "nextlayer.next_layer.api.aerodata_utils.get_flight_details",
		args: {
			flight_number: flight_number,
			flight_date: flight_date || null,
		},
		callback: function (r) {
			flight_lookup_in_progress = false;
			if (r.message) {
				const result = r.message;
				if (result.success) {
					show_flight_confirmation_modal(frm, result.data, flight_number, null);
				} else {
					frappe.show_alert(__("Failed to fetch flight details: ") + (result.error || "Unknown error"), 5, "red");
					frappe.msgprint({
						title: __("Flight Lookup Failed"),
						message: __(
							`<div style="padding: 10px;">
								<p><strong>Flight Number:</strong> ${flight_number}</p>
								<p><strong>Error:</strong> ${result.error || "Unknown error"}</p>
								${result.error_details ? `<p><strong>Details:</strong> ${result.error_details}</p>` : ""}
							</div>`
						),
						indicator: "red",
					});
				}
			}
		},
		error: function () {
			flight_lookup_in_progress = false;
		},
	});
}

/** When Historical is ticked: ask for From/To date, fetch via historical API, then show same confirmation modal and on accept auto-fill like normal. */
function show_historical_date_range_modal(frm, flight_number) {
	let d = new frappe.ui.Dialog({
		title: __("Historical Flight — Select Date Range"),
		fields: [
			{
				fieldtype: "Section Break",
				label: __("Date Range"),
			},
			{
				fieldtype: "Data",
				fieldname: "flight_number_display",
				label: __("Flight Number"),
				read_only: 1,
				default: flight_number,
			},
			{
				fieldtype: "Date",
				fieldname: "date_from",
				label: __("From Date"),
				reqd: 1,
				description: __("Start of period (YYYY-MM-DD)"),
			},
			{
				fieldtype: "Date",
				fieldname: "date_to",
				label: __("To Date"),
				reqd: 1,
				description: __("End of period (YYYY-MM-DD)"),
			},
		],
		primary_action_label: __("Fetch"),
		primary_action: function (values) {
			d.hide();
			let date_from = values.date_from || null;
			let date_to = values.date_to || null;
			if (!date_from || !date_to) {
				frappe.msgprint({ title: __("Required"), message: __("Please enter From Date and To Date."), indicator: "orange" });
				return;
			}
			flight_lookup_in_progress = true;
			frappe.show_alert(__("Fetching historical flight data..."), 3);
			frappe.call({
				method: "nextlayer.next_layer.api.aerodata_utils.get_flight_history",
				args: {
					flight_number: flight_number,
					date_from: date_from,
					date_to: date_to,
				},
				callback: function (r) {
					flight_lookup_in_progress = false;
					if (!r.message) return;
					let res = r.message;
					if (res.success && res.data && res.data.length > 0) {
						// Show same confirmation modal as normal lookup; on confirm, fill_travel_expense_fields runs and auto-fills travel fields
						show_flight_confirmation_modal(frm, res.data, flight_number, null);
					} else {
						frappe.msgprint({
							title: __("Historical Lookup Failed"),
							message: __(
								"<div style='padding: 10px;'><p><strong>Error:</strong> " +
								(res.error || "No flights found for this range.") +
								"</p>" +
								(res.error_details ? "<p><strong>Details:</strong> " + res.error_details + "</p>" : "") +
								"</div>"
							),
							indicator: "red",
						});
					}
				},
				error: function () {
					flight_lookup_in_progress = false;
				},
			});
		},
		secondary_action_label: __("Cancel"),
		secondary_action: function () {
			d.hide();
		},
	});
	d.show();
}

function setup_second_flight_listeners(frm) {
	// Add event listeners to second flight number field for Enter key and blur
	// Use setTimeout to ensure field is available after form refresh
	setTimeout(function() {
		if (frm.fields_dict.flight_no_2 && frm.fields_dict.flight_no_2.$input) {
			frm.fields_dict.flight_no_2.$input.off('keydown blur');
			
			frm.fields_dict.flight_no_2.$input.on('keydown', function(e) {
				if (e.keyCode === 13) {
					e.preventDefault();
					if (frm.doc.flight_no_2 && frm.doc.flight_no_2.trim() && frm.doc.trip_type === "In Transit") {
						if (!flight_lookup_in_progress) {
							lookup_flight_for_travel_expense_second_flight(frm);
						}
					}
				}
			});
			
			frm.fields_dict.flight_no_2.$input.on('blur', function() {
				if (frm.doc.flight_no_2 && frm.doc.flight_no_2.trim() && frm.doc.trip_type === "In Transit") {
					if (!flight_lookup_in_progress) {
						lookup_flight_for_travel_expense_second_flight(frm);
					}
				}
			});
		}
	}, 100);
}

function lookup_flight_for_travel_expense_second_flight(frm) {
	let flight_number = frm.doc.flight_no_2 ? frm.doc.flight_no_2.trim() : "";
	
	if (!flight_number) {
		return;
	}
	
	if (frm.doc.trip_type !== "In Transit") {
		return;
	}
	
	// Skip if lookup is already in progress
	if (flight_lookup_in_progress) {
		return;
	}
	
	// Get flight date if available (use second flight date if available, otherwise use first flight date)
	let flight_date = null;
	if (frm.doc.custom_date_of_travel_2) {
		// Convert to YYYY-MM-DD format if it's a datetime field
		flight_date = frappe.datetime.str_to_obj(frm.doc.custom_date_of_travel_2);
		if (flight_date) {
			flight_date = frappe.datetime.obj_to_str(flight_date).split(' ')[0]; // Get date part only
		}
	} else if (frm.doc.flight_date) {
		// Fallback to main form flight date
		flight_date = frappe.datetime.str_to_obj(frm.doc.flight_date);
		if (flight_date) {
			flight_date = frappe.datetime.obj_to_str(flight_date).split(' ')[0]; // Get date part only
		}
	}
	
	// Mark lookup as in progress
	flight_lookup_in_progress = true;
	
	frappe.show_alert(__("Looking up second flight information..."), 3);
	
	frappe.call({
		method: "nextlayer.next_layer.api.aerodata_utils.get_flight_details",
		args: {
			flight_number: flight_number,
			flight_date: flight_date || null,
		},
		callback: function (r) {
			// Clear lookup flag
			flight_lookup_in_progress = false;
			
			if (r.message) {
				const result = r.message;
				
				if (result.success) {
					// Show flight details modal for user confirmation (for second flight)
					show_flight_confirmation_modal(frm, result.data, flight_number, null, true);
				} else {
					frappe.show_alert(
						__("Failed to fetch second flight details: ") + (result.error || "Unknown error"),
						5,
						"red"
					);
					
					frappe.msgprint({
						title: __("Second Flight Lookup Failed"),
						message: __(`
							<div style="padding: 10px;">
								<p><strong>Flight Number:</strong> ${flight_number}</p>
								<p><strong>Error:</strong> ${result.error || "Unknown error"}</p>
								${result.error_details ? `<p><strong>Details:</strong> ${result.error_details}</p>` : ""}
							</div>
						`),
						indicator: "red",
					});
				}
			}
		},
		error: function() {
			// Clear lookup flag on error
			flight_lookup_in_progress = false;
		}
	});
}

function lookup_flight_for_travel_expense_detail(frm, row, row_key) {
	let flight_number = row.custom_flight_no ? row.custom_flight_no.trim() : "";
	
	if (!flight_number) {
		return;
	}
	
	// Skip if lookup is already in progress for this row
	if (flight_lookup_in_progress === row_key) {
		return;
	}
	
	// Get flight date if available (check row first, then parent form)
	let flight_date = null;
	if (row.flight_date) {
		// Convert to YYYY-MM-DD format if it's a date field
		flight_date = frappe.datetime.str_to_obj(row.flight_date);
		if (flight_date) {
			flight_date = frappe.datetime.obj_to_str(flight_date).split(' ')[0]; // Get date part only
		}
	} else if (frm.doc.flight_date) {
		// Fallback to main form flight date if child row doesn't have it
		flight_date = frappe.datetime.str_to_obj(frm.doc.flight_date);
		if (flight_date) {
			flight_date = frappe.datetime.obj_to_str(flight_date).split(' ')[0];
		}
	}
	
	// Mark lookup as in progress
	flight_lookup_in_progress = row_key;
	
	frappe.show_alert(__("Looking up flight information..."), 3);
	
	frappe.call({
		method: "nextlayer.next_layer.api.aerodata_utils.get_flight_details",
		args: {
			flight_number: flight_number,
			flight_date: flight_date || null,
		},
		callback: function (r) {
			// Clear lookup flag
			flight_lookup_in_progress = false;
			
			if (r.message) {
				const result = r.message;
				
				if (result.success) {
					// Show flight details modal for user confirmation (for child row - fills specific row)
					show_flight_confirmation_modal(frm, result.data, flight_number, row);
				} else {
					frappe.show_alert(
						__("Failed to fetch flight details: ") + (result.error || "Unknown error"),
						5,
						"red"
					);
					
					frappe.msgprint({
						title: __("Flight Lookup Failed"),
						message: __(`
							<div style="padding: 10px;">
								<p><strong>Flight Number:</strong> ${flight_number}</p>
								<p><strong>Error:</strong> ${result.error || "Unknown error"}</p>
								${result.error_details ? `<p><strong>Details:</strong> ${result.error_details}</p>` : ""}
							</div>
						`),
						indicator: "red",
					});
				}
			}
		},
		error: function() {
			// Clear lookup flag on error
			flight_lookup_in_progress = false;
		}
	});
}

function show_flight_confirmation_modal(frm, flight_data, flight_number_searched, target_row, is_second_flight) {
	if (!flight_data || (Array.isArray(flight_data) && flight_data.length === 0)) {
		frappe.msgprint({
			title: __("No Flight Found"),
			message: __("No flight information found for the provided number."),
			indicator: "orange",
		});
		return;
	}
	
	// Handle both single flight object and array of flights
	let flights = Array.isArray(flight_data) ? flight_data : [flight_data];
	
	// For multi-leg flights, use first departure and last arrival (full journey)
	const first_flight = flights[0];
	const last_flight = flights[flights.length - 1];
	
	// Extract flight information based on Aerodata API structure
	const airline = first_flight.airline || {};
	const departure = first_flight.departure || {}; // First departure (origin)
	const arrival = last_flight.arrival || {}; // Last arrival (final destination)
	
	// Extract airport information
	const dep_airport = departure.airport || {};
	const arr_airport = arrival.airport || {};
	
	// Extract scheduled times
	const dep_scheduled = departure.scheduledTime || {};
	const arr_scheduled = arrival.scheduledTime || {};
	
	// Format datetimes for display (keep full datetime for display)
	const dep_datetime_display = dep_scheduled.local || "";
	const arr_datetime_display = arr_scheduled.local || "";
	
	// Build route display showing all stops
	let route_display = "";
	if (flights.length > 1) {
		let route_parts = [];
		flights.forEach((flight, index) => {
			let dep = flight.departure?.airport?.iata || "";
			let arr = flight.arrival?.airport?.iata || "";
			if (dep && arr) {
				route_parts.push(`${dep} → ${arr}`);
			}
		});
		route_display = route_parts.join(" → ");
	} else {
		route_display = `${dep_airport.iata || "N/A"} → ${arr_airport.iata || "N/A"}`;
	}
	
	// Build HTML for all flight legs
	let flight_legs_html = "";
	flights.forEach((flight, index) => {
		const leg_dep = flight.departure || {};
		const leg_arr = flight.arrival || {};
		const leg_dep_airport = leg_dep.airport || {};
		const leg_arr_airport = leg_arr.airport || {};
		const leg_dep_scheduled = leg_dep.scheduledTime || {};
		const leg_arr_scheduled = leg_arr.scheduledTime || {};
		const leg_arr_predicted = leg_arr.predictedTime || {};
		
		flight_legs_html += `
			<div style="background: #f5f5f5; padding: 15px; border-radius: 5px; margin-bottom: 15px; border-left: 4px solid ${index === 0 ? '#4caf50' : '#2196f3'};">
				<h5 style="margin: 0 0 15px 0; color: #333;">✈️ Flight ${flight.number || flight_number_searched}${flights.length > 1 ? ` - Leg ${index + 1}` : ""}</h5>
				<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-bottom: 10px;">
					<div>
						<p><strong>Flight:</strong> ${flight.number || flight_number_searched}</p>
						<p><strong>Airline:</strong> ${flight.airline?.name || "N/A"} (${flight.airline?.iata || ""}${flight.airline?.icao ? "/" + flight.airline.icao : ""})</p>
						<p><strong>Aircraft:</strong> ${flight.aircraft?.model || "N/A"}</p>
						<p><strong>Status:</strong> <span style="color: ${get_status_color(flight.status)}; font-weight: bold;">${flight.status || "N/A"}</span></p>
					</div>
					<div>
						<p><strong>Route:</strong> ${leg_dep_airport.iata || "N/A"} → ${leg_arr_airport.iata || "N/A"}</p>
						<p><strong>From:</strong> ${leg_dep_airport.name || leg_dep_airport.shortName || "N/A"}</p>
						<p><strong>To:</strong> ${leg_arr_airport.name || leg_arr_airport.shortName || "N/A"}</p>
					</div>
				</div>
				<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; padding-top: 10px; border-top: 1px solid #ddd;">
					<div>
						<p><strong>🛫 Departure</strong></p>
						<p style="margin: 5px 0;"><strong>Local:</strong> ${leg_dep_scheduled.local || "N/A"}</p>
						<p style="margin: 5px 0;"><strong>UTC:</strong> ${leg_dep_scheduled.utc || "N/A"}</p>
						${leg_dep.terminal ? `<p style="margin: 5px 0;"><strong>Terminal:</strong> ${leg_dep.terminal}</p>` : ""}
					</div>
					<div>
						<p><strong>🛬 Arrival</strong></p>
						<p style="margin: 5px 0;"><strong>Local:</strong> ${leg_arr_scheduled.local || "N/A"}</p>
						<p style="margin: 5px 0;"><strong>UTC:</strong> ${leg_arr_scheduled.utc || "N/A"}</p>
						${leg_arr_predicted.local ? `<p style="margin: 5px 0;"><strong>Predicted:</strong> <span style="color: #ff9800;">${leg_arr_predicted.local}</span></p>` : ""}
						${leg_arr.terminal ? `<p style="margin: 5px 0;"><strong>Terminal:</strong> ${leg_arr.terminal}</p>` : ""}
					</div>
				</div>
			</div>
		`;
	});
	
	// Determine modal title and confirmation message based on whether it's second flight
	let modal_title = is_second_flight ? __("Confirm Second Flight Information") : __("Confirm Flight Information");
	let confirm_message = is_second_flight 
		? `Click "Confirm" to auto-fill the second flight details with origin (${dep_airport.iata || "N/A"}) to final destination (${arr_airport.iata || "N/A"}).`
		: `Click "Confirm" to auto-fill the travel expense with origin (${dep_airport.iata || "N/A"}) to final destination (${arr_airport.iata || "N/A"}).`;
	
	// Create modal to show flight details and ask for confirmation
	let d = new frappe.ui.Dialog({
		title: modal_title,
		fields: [
			{
				fieldtype: "HTML",
				fieldname: "flight_info",
				options: `
					<div style="padding: 15px; max-width: 900px;">
						<h3 style="margin-top: 0;">✈️ ${is_second_flight ? "Second " : ""}Flight Information (${flights.length} flight leg(s))</h3>
						
						${flight_legs_html}
						
						<div style="margin-top: 20px; padding: 15px; background: #e3f2fd; border-radius: 5px; border-left: 4px solid #1976d2;">
							<h4 style="margin: 0 0 10px 0; color: #1976d2;">📋 Full Journey Summary</h4>
							<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px;">
								<div>
									<p><strong>Origin:</strong> ${dep_airport.name || dep_airport.shortName || "N/A"} (${dep_airport.iata || "N/A"})</p>
									<p><strong>Departure DateTime:</strong> ${dep_datetime_display || "N/A"}</p>
								</div>
								<div>
									<p><strong>Final Destination:</strong> ${arr_airport.name || arr_airport.shortName || "N/A"} (${arr_airport.iata || "N/A"})</p>
									<p><strong>Arrival DateTime:</strong> ${arr_datetime_display || "N/A"}</p>
								</div>
							</div>
							${flights.length > 1 ? `<p style="margin-top: 10px; font-size: 12px; color: #666;"><strong>Complete Route:</strong> ${route_display}</p>` : ""}
						</div>
						
						<div style="margin-top: 15px; padding: 10px; background: #fff3cd; border-radius: 5px;">
							<p style="margin: 0;"><strong>Is this the correct flight information?</strong></p>
							<p style="margin: 5px 0 0 0; font-size: 12px; color: #666;">${confirm_message}</p>
						</div>
					</div>
				`,
			},
		],
		primary_action_label: __("Confirm"),
		primary_action: function (values) {
			if (is_second_flight) {
				// Fill second flight fields
				fill_second_flight_fields(frm, flight_data, flight_number_searched);
			} else {
				// Auto-fill the travel expense detail fields
				// Pass all flights to handle multi-leg journeys
				// If target_row is provided, fill that specific row; otherwise find/create Travel row
				fill_travel_expense_fields(frm, flights, dep_airport, arr_airport, airline, dep_scheduled, arr_scheduled, target_row);
			}
			d.hide();
		},
		secondary_action_label: __("Cancel"),
		secondary_action: function () {
			d.hide();
		},
	});
	
	d.show();
}

function fill_travel_expense_fields(frm, flights, dep_airport, arr_airport, airline, dep_scheduled, arr_scheduled, target_row) {
	// Handle both single flight and array of flights
	let flight_array = Array.isArray(flights) ? flights : [flights];
	
	// Extract airport information
	let dep_airport_name = dep_airport.name || dep_airport.shortName || "";
	let dep_airport_iata = dep_airport.iata || "";
	let dep_airport_icao = dep_airport.icao || "";
	let dep_airport_city = dep_airport.municipalityName || "";
	let dep_airport_country = dep_airport.countryCode || "";
	
	let arr_airport_name = arr_airport.name || arr_airport.shortName || "";
	let arr_airport_iata = arr_airport.iata || "";
	let arr_airport_icao = arr_airport.icao || "";
	let arr_airport_city = arr_airport.municipalityName || "";
	let arr_airport_country = arr_airport.countryCode || "";
	
	// Extract airline information
	let airline_name = airline.name || "";
	let airline_iata = airline.iata || "";
	let airline_icao = airline.icao || "";
	
	// Extract datetime from scheduled times
	let dep_datetime = null;
	let arr_datetime = null;
	
	// Helper function to convert datetime string to Frappe format
	function format_datetime_for_frappe(datetime_str) {
		if (!datetime_str) return null;
		
		try {
			let cleaned = datetime_str.trim();
			
			// Remove timezone patterns: +HH:MM, -HH:MM, +HHMM, -HHMM at the end
			cleaned = cleaned.replace(/[+-]\d{2}:?\d{2}\s*$/, '');
			
			// Handle ISO format with T separator
			if (cleaned.includes('T')) {
				cleaned = cleaned.replace('T', ' ');
			}
			
			// Split into date and time parts
			let parts = cleaned.trim().split(/\s+/);
			if (parts.length < 2) {
				// Try to extract manually if split didn't work
				// Format: "2025-12-25 11:30" (timezone already removed)
				let match = cleaned.match(/^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}(?::\d{2})?)/);
				if (match) {
					parts = [match[1], match[2]];
				} else {
					return null;
				}
			}
			
			let date_part = parts[0]; // YYYY-MM-DD
			let time_part = parts[1]; // HH:mm or HH:mm:ss or HH:mm:ss.xxx
			
			// Remove milliseconds if present
			if (time_part.includes('.')) {
				time_part = time_part.split('.')[0];
			}
			
			// Ensure time has seconds (HH:mm -> HH:mm:ss)
			if (time_part.match(/^\d{2}:\d{2}$/)) {
				time_part = time_part + ':00';
			}
			
			// Combine to Frappe format: YYYY-MM-DD HH:mm:ss
			let formatted = date_part + ' ' + time_part;
			
			// Validate format matches YYYY-MM-DD HH:mm:ss
			if (formatted.match(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)) {
				return formatted;
			}
			
			// Log for debugging if format doesn't match
			console.warn("Datetime format validation failed. Input:", datetime_str, "Formatted:", formatted);
			return null;
		} catch (e) {
			frappe.log_error("Error formatting datetime: " + e.message + " | Input: " + datetime_str, "Flight Datetime Format Error");
			return null;
		}
	}
	
	if (dep_scheduled.local) {
		dep_datetime = format_datetime_for_frappe(dep_scheduled.local);
	}
	
	if (arr_scheduled.local) {
		arr_datetime = format_datetime_for_frappe(arr_scheduled.local);
	}
	
	// Determine which row to fill
	let target_expense_row = null;
	
	if (target_row) {
		// If target_row is provided (from child table), use that specific row
		target_expense_row = target_row;
	} else {
		// Remove empty rows (rows with no expense_type) before processing
		if (frm.doc.expenses && frm.doc.expenses.length > 0) {
			// Collect rows to remove (iterate backwards to avoid index issues)
			let rows_to_remove = [];
			for (let i = frm.doc.expenses.length - 1; i >= 0; i--) {
				let row = frm.doc.expenses[i];
				// Check if row is empty (no expense_type)
				if (!row.expense_type || row.expense_type.trim() === "") {
					rows_to_remove.push(i);
				}
			}
			// Remove empty rows
			if (rows_to_remove.length > 0) {
				rows_to_remove.forEach(function(index) {
					frappe.model.remove_from_locals("Travel Expense Detail", frm.doc.expenses[index].name);
					frm.doc.expenses.splice(index, 1);
				});
				// Refresh the expenses field to update UI
				frm.refresh_field("expenses");
			}
		}
		
		// Otherwise, find or create Travel expense row (from main form)
		// Check if there's an existing expense with "Travel" in expense_type
		if (frm.doc.expenses && frm.doc.expenses.length > 0) {
			for (let i = 0; i < frm.doc.expenses.length; i++) {
				let row = frm.doc.expenses[i];
				if (row.expense_type && row.expense_type.toLowerCase().includes("travel")) {
					target_expense_row = row;
					break;
				}
			}
		}
		
		// If no Travel row found, create a new one
		if (!target_expense_row) {
			// Add a new row to the expenses child table
			let new_row = frm.add_child("expenses");
			new_row.expense_type = "Travel";
			target_expense_row = new_row;
			frm.refresh_field("expenses");
		}
	}
	
	// Show loading message
	frappe.show_alert(__("Creating/updating airline and airport records..."), 3);
	
	// Create/get airline and airports, then fill the fields
	let promises = [];
	
	// Get or create airline
	if (airline_name) {
		promises.push(
			frappe.call({
				method: "nextlayer.next_layer.api.flight_utils.get_or_create_airline",
				args: {
					airline_name: airline_name,
					airline_iata: airline_iata,
					airline_icao: airline_icao,
				},
			})
		);
	} else {
		promises.push(Promise.resolve({ message: null }));
	}
	
	// Get or create departure airport
	if (dep_airport_name) {
		promises.push(
			frappe.call({
				method: "nextlayer.next_layer.api.flight_utils.get_or_create_airport",
				args: {
					airport_name: dep_airport_name,
					airport_iata: dep_airport_iata,
					airport_icao: dep_airport_icao,
					airport_city: dep_airport_city,
					airport_country: dep_airport_country,
				},
			})
		);
	} else {
		promises.push(Promise.resolve({ message: null }));
	}
	
	// Get or create arrival airport
	if (arr_airport_name) {
		promises.push(
			frappe.call({
				method: "nextlayer.next_layer.api.flight_utils.get_or_create_airport",
				args: {
					airport_name: arr_airport_name,
					airport_iata: arr_airport_iata,
					airport_icao: arr_airport_icao,
					airport_city: arr_airport_city,
					airport_country: arr_airport_country,
				},
			})
		);
	} else {
		promises.push(Promise.resolve({ message: null }));
	}
	
	// Wait for all API calls to complete
	Promise.all(promises).then(function(results) {
		let airline_record = results[0].message || null;
		let dep_airport_record = results[1].message || null;
		let arr_airport_record = results[2].message || null;
		
		// Fill in the flight details with linked records in child table
		if (dep_airport_record) {
			frappe.model.set_value(target_expense_row.doctype, target_expense_row.name, "custom_departure_airport", dep_airport_record);
		}
		
		if (arr_airport_record) {
			frappe.model.set_value(target_expense_row.doctype, target_expense_row.name, "custom_arrival_airport", arr_airport_record);
		}
		
		if (airline_record) {
			frappe.model.set_value(target_expense_row.doctype, target_expense_row.name, "custom_airlines", airline_record);
		}
		
		if (dep_datetime) {
			frappe.model.set_value(target_expense_row.doctype, target_expense_row.name, "custom_date_of_travel", dep_datetime);
		}
		
		if (arr_datetime) {
			frappe.model.set_value(target_expense_row.doctype, target_expense_row.name, "custom_date_of_arrival", arr_datetime);
		}
		
		// Also fill main Travel Expense doctype fields
		// Update the document directly and then refresh
		if (dep_airport_record) {
			frm.doc.custom_departure_airport = dep_airport_record;
			frm.set_value("custom_departure_airport", dep_airport_record);
		}
		
		if (arr_airport_record) {
			frm.doc.custom_arrival_airport = arr_airport_record;
			frm.set_value("custom_arrival_airport", arr_airport_record);
		}
		
		if (airline_record) {
			frm.doc.custom_airlines = airline_record;
			frm.set_value("custom_airlines", airline_record);
		}
		
		if (dep_datetime) {
			frm.doc.custom_date_of_travel = dep_datetime;
			frm.set_value("custom_date_of_travel", dep_datetime);
		}
		
		if (arr_datetime) {
			frm.doc.custom_date_of_arrival = arr_datetime;
			frm.set_value("custom_date_of_arrival", arr_datetime);
		}
		
		// Also update locals to ensure data persistence
		if (locals[frm.doctype] && locals[frm.doctype][frm.doc.name]) {
			if (dep_airport_record) locals[frm.doctype][frm.doc.name].custom_departure_airport = dep_airport_record;
			if (arr_airport_record) locals[frm.doctype][frm.doc.name].custom_arrival_airport = arr_airport_record;
			if (airline_record) locals[frm.doctype][frm.doc.name].custom_airlines = airline_record;
			if (dep_datetime) locals[frm.doctype][frm.doc.name].custom_date_of_travel = dep_datetime;
			if (arr_datetime) locals[frm.doctype][frm.doc.name].custom_date_of_arrival = arr_datetime;
		}
		
		frappe.show_alert(__("Flight information filled successfully!"), 3, "green");
		
		// Refresh the form to show updated values
		frm.refresh_field("expenses");
		// Refresh main doctype fields
		setTimeout(function() {
			frm.refresh_field("custom_departure_airport");
			frm.refresh_field("custom_arrival_airport");
			frm.refresh_field("custom_airlines");
			frm.refresh_field("custom_date_of_travel");
			frm.refresh_field("custom_date_of_arrival");
		}, 200);
	}).catch(function(error) {
		frappe.show_alert(__("Error creating airline/airport records. Please check manually."), 5, "red");
		frappe.log_error(error, "Travel Expense Flight Fill Error");
	});
}

function fill_second_flight_fields(frm, flight_data, flight_number_searched) {
	if (!flight_data || (Array.isArray(flight_data) && flight_data.length === 0)) {
		frappe.show_alert(__("No flight data found for second flight."), 5, "orange");
		return;
	}
	
	// Handle both single flight object and array of flights
	let flights = Array.isArray(flight_data) ? flight_data : [flight_data];
	
	// For multi-leg flights, use first departure and last arrival (full journey)
	const first_flight = flights[0];
	const last_flight = flights[flights.length - 1];
	
	// Extract flight information based on Aerodata API structure
	const departure = first_flight.departure || {}; // First departure (origin)
	const arrival = last_flight.arrival || {}; // Last arrival (final destination)
	
	// Extract airport information
	const dep_airport = departure.airport || {};
	const arr_airport = arrival.airport || {};
	
	let dep_airport_name = dep_airport.name || dep_airport.shortName || "";
	let dep_airport_iata = dep_airport.iata || "";
	let dep_airport_icao = dep_airport.icao || "";
	let dep_airport_city = dep_airport.municipalityName || "";
	let dep_airport_country = dep_airport.countryCode || "";
	
	let arr_airport_name = arr_airport.name || arr_airport.shortName || "";
	let arr_airport_iata = arr_airport.iata || "";
	let arr_airport_icao = arr_airport.icao || "";
	let arr_airport_city = arr_airport.municipalityName || "";
	let arr_airport_country = arr_airport.countryCode || "";
	
	// Extract datetime from scheduled times
	const dep_scheduled = departure.scheduledTime || {};
	const arr_scheduled = arrival.scheduledTime || {};
	
	// Helper function to convert datetime string to Frappe format
	function format_datetime_for_frappe(datetime_str) {
		if (!datetime_str) return null;
		
		try {
			let cleaned = datetime_str.trim();
			
			// Remove timezone patterns: +HH:MM, -HH:MM, +HHMM, -HHMM at the end
			cleaned = cleaned.replace(/[+-]\d{2}:?\d{2}\s*$/, '');
			
			// Handle ISO format with T separator
			if (cleaned.includes('T')) {
				cleaned = cleaned.replace('T', ' ');
			}
			
			// Split into date and time parts
			let parts = cleaned.trim().split(/\s+/);
			if (parts.length < 2) {
				// Try to extract manually if split didn't work
				let match = cleaned.match(/^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}(?::\d{2})?)/);
				if (match) {
					parts = [match[1], match[2]];
				} else {
					return null;
				}
			}
			
			let date_part = parts[0]; // YYYY-MM-DD
			let time_part = parts[1]; // HH:mm or HH:mm:ss or HH:mm:ss.xxx
			
			// Remove milliseconds if present
			if (time_part.includes('.')) {
				time_part = time_part.split('.')[0];
			}
			
			// Ensure time has seconds (HH:mm -> HH:mm:ss)
			if (time_part.match(/^\d{2}:\d{2}$/)) {
				time_part = time_part + ':00';
			}
			
			// Combine to Frappe format: YYYY-MM-DD HH:mm:ss
			let formatted = date_part + ' ' + time_part;
			
			// Validate format matches YYYY-MM-DD HH:mm:ss
			if (formatted.match(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)) {
				return formatted;
			}
			
			console.warn("Datetime format validation failed. Input:", datetime_str, "Formatted:", formatted);
			return null;
		} catch (e) {
			frappe.log_error("Error formatting datetime: " + e.message + " | Input: " + datetime_str, "Second Flight Datetime Format Error");
			return null;
		}
	}
	
	let dep_datetime = null;
	let arr_datetime = null;
	
	// Format datetimes for Frappe
	if (dep_scheduled && dep_scheduled.local) {
		dep_datetime = format_datetime_for_frappe(dep_scheduled.local);
	}
	
	if (arr_scheduled && arr_scheduled.local) {
		arr_datetime = format_datetime_for_frappe(arr_scheduled.local);
	}
	
	// Show loading message
	frappe.show_alert(__("Creating/updating airline and airport records for second flight..."), 3);
	
	// Create/get airline and airports, then fill the fields
	let promises = [];
	
	// Get or create departure airport
	if (dep_airport_name) {
		promises.push(
			frappe.call({
				method: "nextlayer.next_layer.api.flight_utils.get_or_create_airport",
				args: {
					airport_name: dep_airport_name,
					airport_iata: dep_airport_iata,
					airport_icao: dep_airport_icao,
					airport_city: dep_airport_city,
					airport_country: dep_airport_country,
				},
			})
		);
	} else {
		promises.push(Promise.resolve({ message: null }));
	}
	
	// Get or create arrival airport
	if (arr_airport_name) {
		promises.push(
			frappe.call({
				method: "nextlayer.next_layer.api.flight_utils.get_or_create_airport",
				args: {
					airport_name: arr_airport_name,
					airport_iata: arr_airport_iata,
					airport_icao: arr_airport_icao,
					airport_city: arr_airport_city,
					airport_country: arr_airport_country,
				},
			})
		);
	} else {
		promises.push(Promise.resolve({ message: null }));
	}
	
	// Wait for all API calls to complete
	Promise.all(promises).then(function(results) {
		let dep_airport_record = results[0].message || null;
		let arr_airport_record = results[1].message || null;
		
		// Fill in the second flight details
		if (dep_airport_record) {
			frm.doc.custom_departure_airport_2 = dep_airport_record;
			frm.set_value("custom_departure_airport_2", dep_airport_record);
		}
		
		if (arr_airport_record) {
			frm.doc.custom_arrival_airport_2 = arr_airport_record;
			frm.set_value("custom_arrival_airport_2", arr_airport_record);
		}
		
		if (dep_datetime) {
			frm.doc.custom_date_of_travel_2 = dep_datetime;
			frm.set_value("custom_date_of_travel_2", dep_datetime);
		}
		
		if (arr_datetime) {
			frm.doc.custom_date_of_arrival_2 = arr_datetime;
			frm.set_value("custom_date_of_arrival_2", arr_datetime);
		}
		
		// Also update locals to ensure data persistence
		if (locals[frm.doctype] && locals[frm.doctype][frm.doc.name]) {
			if (dep_airport_record) locals[frm.doctype][frm.doc.name].custom_departure_airport_2 = dep_airport_record;
			if (arr_airport_record) locals[frm.doctype][frm.doc.name].custom_arrival_airport_2 = arr_airport_record;
			if (dep_datetime) locals[frm.doctype][frm.doc.name].custom_date_of_travel_2 = dep_datetime;
			if (arr_datetime) locals[frm.doctype][frm.doc.name].custom_date_of_arrival_2 = arr_datetime;
		}
		
		frappe.show_alert(__("Second flight information filled successfully!"), 3, "green");
		
		// Refresh the form to show updated values
		setTimeout(function() {
			frm.refresh_field("custom_departure_airport_2");
			frm.refresh_field("custom_arrival_airport_2");
			frm.refresh_field("custom_date_of_travel_2");
			frm.refresh_field("custom_date_of_arrival_2");
		}, 200);
	}).catch(function(error) {
		frappe.show_alert(__("Error creating airport records for second flight. Please check manually."), 5, "red");
		frappe.log_error(error, "Second Flight Fill Error");
	});
}

/** Multi City segment: fetch flight by flight_no + flight_date, show modal, on confirm fill the segment row. */
function lookup_flight_for_multi_city_row(frm, row) {
	let flight_number = (row.flight_no && row.flight_no.trim()) ? row.flight_no.trim() : "";
	if (!flight_number) {
		frappe.msgprint(__("Enter Flight No in the selected segment row."));
		return;
	}
	if (flight_lookup_in_progress) return;
	let flight_date = null;
	if (row.flight_date) {
		flight_date = frappe.datetime.str_to_obj(row.flight_date);
		if (flight_date) {
			flight_date = frappe.datetime.obj_to_str(flight_date).split(" ")[0];
		}
	}
	flight_lookup_in_progress = true;
	frappe.show_alert(__("Looking up flight information..."), 3);
	frappe.call({
		method: "nextlayer.next_layer.api.aerodata_utils.get_flight_details",
		args: {
			flight_number: flight_number,
			flight_date: flight_date || null,
		},
		callback: function(r) {
			flight_lookup_in_progress = false;
			if (r.message && r.message.success) {
				show_flight_confirmation_modal_for_multi_city(frm, r.message.data, flight_number, row);
			} else {
				frappe.msgprint({
					title: __("Flight Lookup Failed"),
					message: (r.message && r.message.error) || __("Unknown error"),
					indicator: "red",
				});
			}
		},
		error: function() {
			flight_lookup_in_progress = false;
		}
	});
}

function show_flight_confirmation_modal_for_multi_city(frm, flight_data, flight_number_searched, multi_city_row) {
	if (!flight_data || (Array.isArray(flight_data) && flight_data.length === 0)) {
		frappe.msgprint({ title: __("No Flight Found"), message: __("No flight information found."), indicator: "orange" });
		return;
	}
	let flights = Array.isArray(flight_data) ? flight_data : [flight_data];
	const first_flight = flights[0];
	const last_flight = flights[flights.length - 1];
	const departure = first_flight.departure || {};
	const arrival = last_flight.arrival || {};
	const dep_airport = departure.airport || {};
	const arr_airport = arrival.airport || {};
	const dep_scheduled = departure.scheduledTime || {};
	const arr_scheduled = arrival.scheduledTime || {};
	const airline = first_flight.airline || {};
	let route_display = `${dep_airport.iata || "N/A"} → ${arr_airport.iata || "N/A"}`;
	let html = `
		<div style="padding: 15px;">
			<p><strong>Route:</strong> ${route_display}</p>
			<p><strong>Departure:</strong> ${dep_scheduled.local || "N/A"}</p>
			<p><strong>Arrival:</strong> ${arr_scheduled.local || "N/A"}</p>
			<p>Click Confirm to auto-fill this segment row.</p>
		</div>`;
	let d = new frappe.ui.Dialog({
		title: __("Confirm Flight for Segment"),
		fields: [{ fieldtype: "HTML", fieldname: "flight_info", options: html }],
		primary_action_label: __("Confirm"),
		primary_action: function() {
			fill_multi_city_row_from_flight(frm, flights, dep_airport, arr_airport, airline, dep_scheduled, arr_scheduled, multi_city_row);
			d.hide();
		},
		secondary_action_label: __("Cancel"),
		secondary_action: function() { d.hide(); },
	});
	d.show();
}

function fill_multi_city_row_from_flight(frm, flights, dep_airport, arr_airport, airline, dep_scheduled, arr_scheduled, multi_city_row) {
	let flight_array = Array.isArray(flights) ? flights : [flights];
	const first_flight = flight_array[0];
	const last_flight = flight_array[flight_array.length - 1];
	const dep = first_flight.departure || {};
	const arr = last_flight.arrival || {};
	const dep_airport_obj = dep.airport || {};
	const arr_airport_obj = arr.airport || {};
	const dep_sched = dep.scheduledTime || {};
	const arr_sched = arr.scheduledTime || {};
	let dep_airport_name = dep_airport_obj.name || dep_airport_obj.shortName || "";
	let dep_airport_iata = dep_airport_obj.iata || "";
	let dep_airport_icao = dep_airport_obj.icao || "";
	let dep_airport_city = dep_airport_obj.municipalityName || "";
	let dep_airport_country = dep_airport_obj.countryCode || "";
	let arr_airport_name = arr_airport_obj.name || arr_airport_obj.shortName || "";
	let arr_airport_iata = arr_airport_obj.iata || "";
	let arr_airport_icao = arr_airport_obj.icao || "";
	let arr_airport_city = arr_airport_obj.municipalityName || "";
	let arr_airport_country = arr_airport_obj.countryCode || "";
	let airline_name = (airline && airline.name) || "";
	let airline_iata = (airline && airline.iata) || "";
	let airline_icao = (airline && airline.icao) || "";
	function format_dt(str) {
		if (!str) return null;
		try {
			let cleaned = (str.trim() || "").replace(/[+-]\d{2}:?\d{2}\s*$/, "").replace("T", " ");
			let parts = cleaned.split(/\s+/);
			if (parts.length < 2) return null;
			let time = parts[1].split(".")[0];
			if (time.match(/^\d{2}:\d{2}$/)) time += ":00";
			return parts[0] + " " + time;
		} catch (e) { return null; }
	}
	let dep_datetime = format_dt((dep_scheduled && dep_scheduled.local) ? dep_scheduled.local : (dep_sched && dep_sched.local) ? dep_sched.local : null);
	let arr_datetime = format_dt((arr_scheduled && arr_scheduled.local) ? arr_scheduled.local : (arr_sched && arr_sched.local) ? arr_sched.local : null);
	let date_of_purchase = dep_datetime ? dep_datetime.split(" ")[0] : null;
	frappe.show_alert(__("Creating/updating airline and airport records..."), 3);
	let promises = [];
	if (airline_name) {
		promises.push(frappe.call({
			method: "nextlayer.next_layer.api.flight_utils.get_or_create_airline",
			args: { airline_name: airline_name, airline_iata: airline_iata, airline_icao: airline_icao },
		}));
	} else { promises.push(Promise.resolve({ message: null })); }
	if (dep_airport_name) {
		promises.push(frappe.call({
			method: "nextlayer.next_layer.api.flight_utils.get_or_create_airport",
			args: { airport_name: dep_airport_name, airport_iata: dep_airport_iata, airport_icao: dep_airport_icao, airport_city: dep_airport_city, airport_country: dep_airport_country },
		}));
	} else { promises.push(Promise.resolve({ message: null })); }
	if (arr_airport_name) {
		promises.push(frappe.call({
			method: "nextlayer.next_layer.api.flight_utils.get_or_create_airport",
			args: { airport_name: arr_airport_name, airport_iata: arr_airport_iata, airport_icao: arr_airport_icao, airport_city: arr_airport_city, airport_country: arr_airport_country },
		}));
	} else { promises.push(Promise.resolve({ message: null })); }
	Promise.all(promises).then(function(results) {
		let airline_record = (results[0] && results[0].message) || null;
		let dep_airport_record = (results[1] && results[1].message) || null;
		let arr_airport_record = (results[2] && results[2].message) || null;
		if (dep_airport_record) {
			frappe.model.set_value(multi_city_row.doctype, multi_city_row.name, "departure_airport", dep_airport_record);
		}
		if (arr_airport_record) {
			frappe.model.set_value(multi_city_row.doctype, multi_city_row.name, "arrival_airport", arr_airport_record);
		}
		if (airline_record) {
			frappe.model.set_value(multi_city_row.doctype, multi_city_row.name, "airlines", airline_record);
		}
		if (dep_datetime) {
			frappe.model.set_value(multi_city_row.doctype, multi_city_row.name, "date_of_travel", dep_datetime);
		}
		if (arr_datetime) {
			frappe.model.set_value(multi_city_row.doctype, multi_city_row.name, "date_of_arrival", arr_datetime);
		}
		if (date_of_purchase) {
			frappe.model.set_value(multi_city_row.doctype, multi_city_row.name, "date_of_purchase", date_of_purchase);
		}
		frappe.show_alert(__("Segment filled successfully!"), 3, "green");
		frm.refresh_field("multi_city_segments");
	}).catch(function(err) {
		frappe.show_alert(__("Error filling segment. Check manually."), 5, "red");
		frappe.log_error(err, "Multi City Flight Fill Error");
	});
}

function get_status_color(status) {
	if (!status) return "#666";
	const status_lower = status.toLowerCase();
	if (status_lower.includes("scheduled") || status_lower.includes("on time") || status_lower.includes("expected")) {
		return "#4caf50";
	} else if (status_lower.includes("delayed")) {
		return "#ff9800";
	} else if (status_lower.includes("cancelled")) {
		return "#f44336";
	} else if (status_lower.includes("landed") || status_lower.includes("arrived")) {
		return "#2196f3";
	} else if (status_lower.includes("in flight") || status_lower.includes("in-air")) {
		return "#00bcd4";
	}
	return "#666";
}

// Function to convert travel_amount from currency (transaction currency) to company currency and update child table
function convert_and_update_amount(frm) {
	// First, ensure travel_amount is set in currency (transaction currency)
	if (!frm.doc.travel_amount || !frm.doc.currency || !frm.doc.company) {
		return;
	}
	
	let travel_amount = parseFloat(frm.doc.travel_amount) || 0;
	if (travel_amount === 0) {
		return;
	}
	
	// travel_amount is already in currency (transaction currency) - keep it as is
	// Now convert to company currency for child table
	
	// Get company default currency
	frappe.db.get_value("Company", frm.doc.company, "default_currency", function(r) {
		if (!r || !r.default_currency) {
			return;
		}
		
		let company_currency = r.default_currency;
		let from_currency = frm.doc.currency; // Transaction currency
		
		// If currencies are the same, no conversion needed
		if (from_currency === company_currency) {
			update_category_row_amount(frm, travel_amount, travel_amount);
			frm.set_value("amountcompany_currency", travel_amount);
			frm.refresh_field("amountcompany_currency");
			return;
		}
		
		// Get exchange rate and convert from transaction currency to company currency
		let transaction_date = frm.doc.posting_date || frappe.datetime.get_today();
		
		frappe.call({
			method: "erpnext.setup.utils.get_exchange_rate",
			args: {
				from_currency: from_currency,
				to_currency: company_currency,
				transaction_date: transaction_date,
				company: frm.doc.company
			},
			callback: function(rate_result) {
				if (rate_result.message) {
					let exchange_rate = rate_result.message;
					let converted_amount = travel_amount * exchange_rate;
					console.log("Travel amount", travel_amount, "converted to", converted_amount, "using rate", exchange_rate);
					update_category_row_amount(frm, travel_amount, converted_amount);
					frm.set_value("amountcompany_currency", converted_amount);
					frm.refresh_field("amountcompany_currency");
					
					// Show conversion info to user
					frappe.show_alert(
						__("Converted: {0} {1} = {2} {3}", [
							travel_amount.toFixed(2),
							from_currency,
							converted_amount.toFixed(2),
							company_currency
						]),
						3,
						"blue"
					);
				} else {
					console.log("Travel amount", travel_amount, "not converted due to missing exchange rate.");
					update_category_row_amount(frm, travel_amount, travel_amount);
					frm.set_value("amountcompany_currency", travel_amount);
					frm.refresh_field("amountcompany_currency");
					frappe.show_alert(
						__("Exchange rate not found. Using original amount."),
						3,
						"orange"
					);
				}
			},
			error: function() {
				update_category_row_amount(frm, travel_amount, travel_amount);
				frm.set_value("amountcompany_currency", travel_amount);
				frm.refresh_field("amountcompany_currency");
			}
		});
	});
}

// Expense categories that use the main Charges (Amount / Amount Company Currency) and push to child table
var CHARGES_EXPENSE_CATEGORIES = ["Travel", "Hotel", "Visa", "Residence and Iqama"];

function get_expense_type_for_charges(frm) {
	if (!frm.doc.expense_category) return null;
	let cat = (frm.doc.expense_category || "").trim();
	if (cat === "" || cat === "All") return null;
	if (CHARGES_EXPENSE_CATEGORIES.indexOf(cat) !== -1) return cat;
	return cat;
}

/** When trip_type is Multi City: ensure one Travel expense row and fill from multi_city_segments (first = departure/PRN/dates, last = arrival). */
function sync_multi_city_to_expenses(frm) {
	let segments = frm.doc.multi_city_segments || [];
	if (segments.length === 0) return;
	let first = segments[0];
	let last = segments[segments.length - 1];
	let travel_row = null;
	if (frm.doc.expenses && frm.doc.expenses.length > 0) {
		for (let i = 0; i < frm.doc.expenses.length; i++) {
			if (frm.doc.expenses[i].expense_type && frm.doc.expenses[i].expense_type.toLowerCase().indexOf("travel") !== -1) {
				travel_row = frm.doc.expenses[i];
				break;
			}
		}
	}
	if (!travel_row) {
		travel_row = frm.add_child("expenses");
		travel_row.expense_type = "Travel";
		travel_row.expense_date = frm.doc.posting_date || frappe.datetime.get_today();
		travel_row.amount = parseFloat(frm.doc.travel_amount) || 0;
		travel_row.amount_company_currency = parseFloat(frm.doc.amountcompany_currency) || travel_row.amount;
		travel_row.sanctioned_amount = travel_row.amount_company_currency || travel_row.amount;
		frappe.model.set_value(travel_row.doctype, travel_row.name, "expense_type", "Travel");
		frappe.model.set_value(travel_row.doctype, travel_row.name, "expense_date", travel_row.expense_date);
		frappe.model.set_value(travel_row.doctype, travel_row.name, "amount", travel_row.amount);
		frappe.model.set_value(travel_row.doctype, travel_row.name, "amount_company_currency", travel_row.amount_company_currency);
		frappe.model.set_value(travel_row.doctype, travel_row.name, "sanctioned_amount", travel_row.sanctioned_amount);
	}
	frappe.model.set_value(travel_row.doctype, travel_row.name, "custom_departure_airport", first.departure_airport || "");
	frappe.model.set_value(travel_row.doctype, travel_row.name, "custom_arrival_airport", last.arrival_airport || "");
	frappe.model.set_value(travel_row.doctype, travel_row.name, "custom_prn_number", first.custom_prn_number || "");
	frappe.model.set_value(travel_row.doctype, travel_row.name, "custom_date_of_purchase", first.date_of_purchase || "");
	frappe.model.set_value(travel_row.doctype, travel_row.name, "custom_travel_type", "Multi-city");
	frappe.model.set_value(travel_row.doctype, travel_row.name, "custom_date_of_travel", first.date_of_travel || "");
	frappe.model.set_value(travel_row.doctype, travel_row.name, "custom_date_of_arrival", last.date_of_arrival || "");
	frappe.model.set_value(travel_row.doctype, travel_row.name, "custom_airlines", first.airlines || "");
	if (frm.doc.travel_amount) {
		frappe.model.set_value(travel_row.doctype, travel_row.name, "amount", frm.doc.travel_amount);
	}
	if (frm.doc.amountcompany_currency) {
		frappe.model.set_value(travel_row.doctype, travel_row.name, "amount_company_currency", frm.doc.amountcompany_currency);
		frappe.model.set_value(travel_row.doctype, travel_row.name, "sanctioned_amount", frm.doc.amountcompany_currency);
	}
	frm.refresh_field("expenses");
}

// Helper: find or create child row for given expense_type and update amount / amount_company_currency
function update_category_row_amount(frm, amount_transaction, amount_company) {
	let expense_type = get_expense_type_for_charges(frm);
	if (!expense_type) return;
	amount_transaction = parseFloat(amount_transaction) || 0;
	amount_company = parseFloat(amount_company) || amount_transaction;

	let target_row = null;
	if (frm.doc.expenses && frm.doc.expenses.length > 0) {
		for (let i = 0; i < frm.doc.expenses.length; i++) {
			let row = frm.doc.expenses[i];
			if (row.expense_type === expense_type) {
				target_row = row;
				break;
			}
		}
	}
	if (!target_row) {
		target_row = frm.add_child("expenses");
		target_row.expense_type = expense_type;
		target_row.expense_date = frm.doc.posting_date || frappe.datetime.get_today();
		frappe.model.set_value(target_row.doctype, target_row.name, "expense_type", expense_type);
		if (frm.doc.posting_date) {
			frappe.model.set_value(target_row.doctype, target_row.name, "expense_date", frm.doc.posting_date);
		}
	}
	frappe.model.set_value(target_row.doctype, target_row.name, "amount", amount_transaction);
	frappe.model.set_value(target_row.doctype, target_row.name, "amount_company_currency", amount_company);
	frappe.model.set_value(target_row.doctype, target_row.name, "sanctioned_amount", amount_company || amount_transaction);
	remove_expense_rows_without_type(frm);
	frm.refresh_field("expenses");
}

function remove_expense_rows_without_type(frm) {
	if (!frm.doc.expenses || frm.doc.expenses.length === 0) return;
	for (let i = frm.doc.expenses.length - 1; i >= 0; i--) {
		let et = (frm.doc.expenses[i].expense_type || "").toString().trim();
		if (!et) {
			frappe.model.remove_from_locals("Travel Expense Detail", frm.doc.expenses[i].name);
			frm.doc.expenses.splice(i, 1);
		}
	}
}

// Helper function to update travel row amount in child table (kept for backward compatibility; uses category)
function update_travel_row_amount(frm, converted_amount) {
	let expense_type = get_expense_type_for_charges(frm) || "Travel";
	let amount_transaction = parseFloat(frm.doc.travel_amount) || converted_amount;
	update_category_row_amount(frm, amount_transaction, converted_amount);
}

function compute_hotel_amount_and_push(frm) {
	if (!frm.doc.hotel_checkin_date || !frm.doc.hotel_checkout_date) return;
	let checkin = new Date(frm.doc.hotel_checkin_date);
	let checkout = new Date(frm.doc.hotel_checkout_date);
	if (checkout < checkin) return;
	let days = Math.ceil((checkout - checkin) / (1000 * 60 * 60 * 24));
	let rate = parseFloat(frm.doc.rate_per_day) || 0;
	frm.set_value("hotel_days", days);
	frm.set_value("total_nights", days);
	frm.refresh_field("hotel_days");
	frm.refresh_field("total_nights");
	if (rate <= 0) return;
	let amount = rate * days;
	frm.set_value("travel_amount", amount);
	frm.refresh_field("travel_amount");
	convert_and_update_amount(frm);
}

// Auto-fill hotel details from original travel expense
function auto_fill_hotel_details(dialog, row, $row_element) {
	let original_frm = dialog.original_frm;
	if (!original_frm || !original_frm.doc) return;
	
	// Get hotel details from original travel expense
	let hotel_checkin_date = original_frm.doc.hotel_checkin_date || "";
	let hotel_checkout_date = original_frm.doc.hotel_checkout_date || "";
	let custom_hotel_name = original_frm.doc.custom_hotel_name || "";
	let hotel_territory = original_frm.doc.hotel_territory || "";
	let hotel_location = original_frm.doc.hotel_location || "";
	let hotel_city = original_frm.doc.hotel_city || "";
	let hotel_country = original_frm.doc.hotel_country || "";
	let rate_per_day = original_frm.doc.rate_per_day || "";
	let purpose = original_frm.doc.purpose || "";
	
	// Fill hotel fields
	if (hotel_checkin_date) {
		$row_element.find('.hotel-checkin-date').val(hotel_checkin_date);
		frappe.model.set_value(row.doctype, row.name, "hotel_checkin_date", hotel_checkin_date);
		row.hotel_checkin_date = hotel_checkin_date;
	}
	
	if (hotel_checkout_date) {
		$row_element.find('.hotel-checkout-date').val(hotel_checkout_date);
		frappe.model.set_value(row.doctype, row.name, "hotel_checkout_date", hotel_checkout_date);
		row.hotel_checkout_date = hotel_checkout_date;
	}
	
	if (custom_hotel_name) {
		$row_element.find('input[data-field="custom_hotel_name"]').val(custom_hotel_name);
		frappe.model.set_value(row.doctype, row.name, "custom_hotel_name", custom_hotel_name);
		row.custom_hotel_name = custom_hotel_name;
	}
	
	if (hotel_territory) {
		let hotel_territory_field = $row_element.data('hotel_territory_field');
		if (hotel_territory_field) {
			hotel_territory_field.set_value(hotel_territory);
		}
		frappe.model.set_value(row.doctype, row.name, "hotel_territory", hotel_territory);
		row.hotel_territory = hotel_territory;
	}
	
	if (hotel_location) {
		let hotel_location_field = $row_element.data('hotel_location_field');
		if (hotel_location_field) {
			hotel_location_field.set_value(hotel_location);
		}
		frappe.model.set_value(row.doctype, row.name, "hotel_location", hotel_location);
		row.hotel_location = hotel_location;
	}
	
	if (hotel_city) {
		$row_element.find('.hotel-city').val(hotel_city);
		frappe.model.set_value(row.doctype, row.name, "hotel_city", hotel_city);
		row.hotel_city = hotel_city;
	}
	
	if (hotel_country) {
		let hotel_country_field = $row_element.data('hotel_country_field');
		if (hotel_country_field) {
			hotel_country_field.set_value(hotel_country);
		}
		frappe.model.set_value(row.doctype, row.name, "hotel_country", hotel_country);
		row.hotel_country = hotel_country;
	}
	
	if (rate_per_day) {
		$row_element.find('input[data-field="rate_per_day"]').val(rate_per_day);
		frappe.model.set_value(row.doctype, row.name, "rate_per_day", rate_per_day);
		row.rate_per_day = rate_per_day;
	}
	
	if (purpose) {
		$row_element.find('.hotel-purpose').val(purpose);
		frappe.model.set_value(row.doctype, row.name, "purpose", purpose);
		row.purpose = purpose;
	}
	
	// Update locals
	if (locals[row.doctype] && locals[row.doctype][row.name]) {
		Object.assign(locals[row.doctype][row.name], {
			hotel_checkin_date: hotel_checkin_date,
			hotel_checkout_date: hotel_checkout_date,
			custom_hotel_name: custom_hotel_name,
			hotel_territory: hotel_territory,
			hotel_location: hotel_location,
			hotel_city: hotel_city,
			hotel_country: hotel_country,
			rate_per_day: rate_per_day,
			purpose: purpose
		});
	}
}

// Auto-fill travel details from original travel expense
function auto_fill_travel_details(dialog, row, $row_element) {
	let original_frm = dialog.original_frm;
	if (!original_frm || !original_frm.doc) return;
	
	// Get travel details from original travel expense
	let custom_prn_number = original_frm.doc.custom_pnr_number_ || "";
	let custom_booked_by = original_frm.doc.custom_booked_by || "";
	let custom_date_of_purchase = original_frm.doc.custom_date_of_purchase || "";
	let custom_departure_airport = original_frm.doc.custom_departure_airport || "";
	let custom_arrival_airport = original_frm.doc.custom_arrival_airport || "";
	let custom_airlines = original_frm.doc.custom_airlines || "";
	let custom_date_of_travel = original_frm.doc.custom_date_of_travel || "";
	let custom_date_of_arrival = original_frm.doc.custom_date_of_arrival || "";
	let custom_travel_type = original_frm.doc.custom_travel_type || "";
	let travel_amount = original_frm.doc.travel_amount || 0;
	
	// Fill travel fields
	if (custom_prn_number) {
		$row_element.find('.prn-number').val(custom_prn_number);
		frappe.model.set_value(row.doctype, row.name, "custom_prn_number", custom_prn_number);
		row.custom_prn_number = custom_prn_number;
	}
	
	if (custom_booked_by) {
		let booked_by_field = $row_element.data('booked_by_field');
		if (booked_by_field) {
			booked_by_field.set_value(custom_booked_by);
		}
		frappe.model.set_value(row.doctype, row.name, "custom_booked_by", custom_booked_by);
		row.custom_booked_by = custom_booked_by;
	}
	
	if (custom_date_of_purchase) {
		$row_element.find('input[data-field="custom_date_of_purchase"]').val(custom_date_of_purchase);
		frappe.model.set_value(row.doctype, row.name, "custom_date_of_purchase", custom_date_of_purchase);
		row.custom_date_of_purchase = custom_date_of_purchase;
	}
	
	if (custom_departure_airport) {
		let departure_airport_field = $row_element.data('departure_airport_field');
		if (departure_airport_field) {
			departure_airport_field.set_value(custom_departure_airport);
		}
		frappe.model.set_value(row.doctype, row.name, "custom_departure_airport", custom_departure_airport);
		row.custom_departure_airport = custom_departure_airport;
	}
	
	if (custom_arrival_airport) {
		let arrival_airport_field = $row_element.data('arrival_airport_field');
		if (arrival_airport_field) {
			arrival_airport_field.set_value(custom_arrival_airport);
		}
		frappe.model.set_value(row.doctype, row.name, "custom_arrival_airport", custom_arrival_airport);
		row.custom_arrival_airport = custom_arrival_airport;
	}
	
	if (custom_airlines) {
		let airlines_field = $row_element.data('airlines_field');
		if (airlines_field) {
			airlines_field.set_value(custom_airlines);
		}
		frappe.model.set_value(row.doctype, row.name, "custom_airlines", custom_airlines);
		row.custom_airlines = custom_airlines;
	}
	
	if (custom_date_of_travel) {
		let date_of_travel_field = $row_element.data('date_of_travel_field');
		if (date_of_travel_field) {
			// Convert datetime to format expected by datetime field
			date_of_travel_field.set_value(custom_date_of_travel);
		}
		frappe.model.set_value(row.doctype, row.name, "custom_date_of_travel", custom_date_of_travel);
		row.custom_date_of_travel = custom_date_of_travel;
	}
	
	if (custom_date_of_arrival) {
		let date_of_arrival_field = $row_element.data('date_of_arrival_field');
		if (date_of_arrival_field) {
			date_of_arrival_field.set_value(custom_date_of_arrival);
		}
		frappe.model.set_value(row.doctype, row.name, "custom_date_of_arrival", custom_date_of_arrival);
		row.custom_date_of_arrival = custom_date_of_arrival;
	}
	
	if (custom_travel_type) {
		$row_element.find('select[data-field="custom_travel_type"]').val(custom_travel_type);
		frappe.model.set_value(row.doctype, row.name, "custom_travel_type", custom_travel_type);
		row.custom_travel_type = custom_travel_type;
	}
	
	// Fill amount field
	if (travel_amount && travel_amount > 0) {
		$row_element.find('input[data-field="amount"]').val(travel_amount);
		frappe.model.set_value(row.doctype, row.name, "amount", travel_amount);
		row.amount = travel_amount;
	}
	
	// Update locals
	if (locals[row.doctype] && locals[row.doctype][row.name]) {
		Object.assign(locals[row.doctype][row.name], {
			custom_prn_number: custom_prn_number,
			custom_booked_by: custom_booked_by,
			custom_date_of_purchase: custom_date_of_purchase,
			custom_departure_airport: custom_departure_airport,
			custom_arrival_airport: custom_arrival_airport,
			custom_airlines: custom_airlines,
			custom_date_of_travel: custom_date_of_travel,
			custom_date_of_arrival: custom_date_of_arrival,
			custom_travel_type: custom_travel_type,
			amount: travel_amount
		});
	}
}

// Additional Expenses Modal
function show_additional_expenses_modal(frm) {
	// Create a temporary document for the child table
	let temp_doc = {
		doctype: "Travel Expense",
		expenses: []
	};
	
	// Get company currency from original travel expense
	let company_currency = null;
	if (frm.doc.company) {
		frappe.db.get_value("Company", frm.doc.company, "default_currency", function(r) {
			if (r && r.default_currency) {
				company_currency = r.default_currency;
			}
		});
	}
	
	// Create a dialog with travel expense detail child table
	let d = new frappe.ui.Dialog({
		title: __("Additional Expenses"),
		size: 'large',
		fields: [
			{
				fieldtype: "Select",
				fieldname: "expense_category",
				label: __("Expense Category"),
				options: "\nRefund\nUpdate",
				default: ""
			},
			{
				fieldtype: "Column Break",
				fieldname: "column_break_category"
			},
			{
				fieldtype: "Link",
				fieldname: "transaction_currency",
				label: __("Transaction Currency"),
				options: "Currency",
				default: frm.doc.currency || company_currency,
				reqd: 1
			},
			{
				fieldtype: "Section Break",
				fieldname: "section_break_expense_details"
			},
			{
				fieldtype: "HTML",
				fieldname: "expense_table",
				options: `
					<div id="additional_expenses_table" style="min-height: 500px; margin-bottom: 20px; width: 100%; max-width: 100%;">
						<!-- Travel Expense Detail table will be rendered here -->
					</div>
					<style>
						#additional_expenses_table {
							width: 100% !important;
							max-width: 100% !important;
						}
						#additional_expenses_table .form-section {
							width: 100% !important;
							max-width: 100% !important;
						}
						#additional_expenses_table .section-body {
							width: 100% !important;
							max-width: 100% !important;
						}
						#additional_expenses_table .expense-items-list {
							width: 100% !important;
							max-width: 100% !important;
						}
						#additional_expenses_table .expense-row {
							width: 100% !important;
							max-width: 100% !important;
							box-sizing: border-box;
						}
						#additional_expenses_table .form-grid {
							width: 100% !important;
							max-width: 100% !important;
						}
						.modal-body [data-fieldname="expense_table"] {
							width: 100% !important;
							max-width: 100% !important;
						}
						.modal-body [data-fieldname="expense_table"] .control-input-wrapper {
							width: 100% !important;
							max-width: 100% !important;
						}
					</style>
				`,
			},
		],
		primary_action_label: __("Create Travel Expense"),
		primary_action: function(values) {
			create_additional_travel_expense(frm, d, temp_doc);
		},
		secondary_action_label: __("Cancel"),
		secondary_action: function() {
			d.hide();
		},
	});
	
	// Store temp_doc in dialog
	d.temp_doc = temp_doc;
	
	// Store company currency in dialog for conversion
	d.company_currency = company_currency;
	d.original_frm = frm; // Store reference to original form
	
	// Show dialog first
	d.show();
	
	// Get company currency if not already set
	if (!company_currency && frm.doc.company) {
		frappe.db.get_value("Company", frm.doc.company, "default_currency", function(r) {
			if (r && r.default_currency) {
				d.company_currency = r.default_currency;
			}
		});
	}
	
	
	// Initialize the child table after dialog is shown
	setTimeout(function() {
		initialize_additional_expenses_table(d, temp_doc);
		
		// Add handler for expense category change
		setTimeout(function() {
			if (d.fields_dict && d.fields_dict.expense_category) {
				d.fields_dict.expense_category.$input.on('change', function() {
					// When category changes, check if Update or Refund is selected and auto-fill existing rows
					let expense_category = d.fields_dict.expense_category.get_value();
					
					// Update all amount labels and cash account fields
					d.$wrapper.find('.expense-row').each(function() {
						update_amount_label($(this), expense_category);
						update_cash_account_field($(this), expense_category);
					});
					
					if ((expense_category === "Update" || expense_category === "Refund") && temp_doc.expenses && temp_doc.expenses.length > 0) {
						temp_doc.expenses.forEach(function(row) {
							let $row_element = d.$wrapper.find(`.expense-row[data-name="${row.name}"]`);
							if ($row_element.length) {
								let expense_type = row.expense_type || "";
								let expense_type_lower = expense_type.toLowerCase();
								
								if (expense_type_lower.includes("hotel")) {
									auto_fill_hotel_details(d, row, $row_element);
								} else if (expense_type_lower.includes("travel")) {
									auto_fill_travel_details(d, row, $row_element);
								}
							}
						});
					}
				});
			}
		}, 100);
		
		// Add handler for transaction currency change to convert all amounts
		setTimeout(function() {
			if (d.fields_dict && d.fields_dict.transaction_currency) {
				d.fields_dict.transaction_currency.$input.on('change', function() {
					// Convert all expense row amounts when currency changes
					if (temp_doc.expenses && temp_doc.expenses.length > 0) {
						let transaction_currency = d.fields_dict.transaction_currency.get_value();
						let company_currency = d.company_currency;
						
						if (!transaction_currency || !company_currency || transaction_currency === company_currency) {
							return;
						}
						
						// Get company for exchange rate
						let company = frm.doc.company;
						if (!company) {
							return;
						}
						
						// Convert each row's amount or rate_per_day
						temp_doc.expenses.forEach(function(row) {
							let $row_element = d.$wrapper.find(`.expense-row[data-name="${row.name}"]`);
							if (!$row_element.length) return;
							
							let expense_type = row.expense_type || "";
							let expense_type_lower = expense_type.toLowerCase().trim();
							
							// For hotel expenses, convert rate_per_day
							if (expense_type_lower === 'hotel' || expense_type_lower.includes('hotel')) {
								let rate_input = $row_element.find('input[data-field="rate_per_day"]');
								let transaction_rate = parseFloat(rate_input.val()) || 0;
								
								if (transaction_rate > 0) {
									let transaction_date = $row_element.find('input[data-field="expense_date"]').val() || frappe.datetime.get_today();
									
									frappe.call({
										method: "erpnext.setup.utils.get_exchange_rate",
										args: {
											from_currency: transaction_currency,
											to_currency: company_currency,
											transaction_date: transaction_date,
											company: company
										},
										callback: function(rate_result) {
											if (rate_result.message) {
												let exchange_rate = rate_result.message;
												let converted_rate = transaction_rate * exchange_rate;
												frappe.model.set_value(row.doctype, row.name, "rate_per_day", converted_rate);
												row.rate_per_day = converted_rate;
												row.converted_rate_per_day = converted_rate;
												rate_input.val(converted_rate.toFixed(2));
												
												// Update locals
												if (locals[row.doctype] && locals[row.doctype][row.name]) {
													locals[row.doctype][row.name].rate_per_day = converted_rate;
												}
												
												// Recalculate hotel totals
												let calculate_totals = $row_element.data('calculate-hotel-totals');
												if (calculate_totals && typeof calculate_totals === 'function') {
													calculate_totals();
												}
											}
										}
									});
								}
							} else {
								// For other expenses, convert amount
								let amount_input = $row_element.find('input[data-field="amount"]');
								let transaction_amount = parseFloat(amount_input.val()) || 0;
								
								if (transaction_amount > 0) {
									let transaction_date = $row_element.find('input[data-field="expense_date"]').val() || frappe.datetime.get_today();
									
									frappe.call({
										method: "erpnext.setup.utils.get_exchange_rate",
										args: {
											from_currency: transaction_currency,
											to_currency: company_currency,
											transaction_date: transaction_date,
											company: company
										},
										callback: function(rate_result) {
											if (rate_result.message) {
												let exchange_rate = rate_result.message;
												let converted_amount = transaction_amount * exchange_rate;
												// Store original transaction currency amount
												row.original_amount_transaction_currency = transaction_amount;
												// Store converted company currency amount for display
												row.amount_company_currency = converted_amount;
												// Keep amount in transaction currency (don't convert it)
												// Just update display to show converted amount
												amount_input.val(converted_amount.toFixed(2));
												// Store the original transaction currency amount in a data attribute
												amount_input.data('transaction-currency-amount', transaction_amount);
												
												// Update locals - keep amount in transaction currency
												if (locals[row.doctype] && locals[row.doctype][row.name]) {
													locals[row.doctype][row.name].amount_company_currency = converted_amount;
													locals[row.doctype][row.name].original_amount_transaction_currency = transaction_amount;
												}
											}
										}
									});
								}
							}
						});
					}
				});
			}
		}, 100);
	}, 500);
}

function initialize_additional_expenses_table(dialog, temp_doc) {
	// Get the wrapper
	let table_wrapper = dialog.$wrapper.find('#additional_expenses_table');
	
	// Create a mock form object for the grid
	let mock_frm = {
		doc: temp_doc,
		add_child: function(child_doctype) {
			return frappe.model.add_child(temp_doc, child_doctype, "expenses");
		},
		refresh_field: function(fieldname) {
			if (fieldname === "expenses" && dialog.grid) {
				dialog.grid.refresh();
			}
		},
		get_docfield: function(fieldname) {
			return null;
		}
	};
	
	// Load doctype first, then create grid
	frappe.model.with_doctype("Travel Expense Detail", function() {
		// Create grid wrapper with full width
		let grid_wrapper = $('<div class="form-grid" style="width: 100%; max-width: 100%;"></div>').appendTo(table_wrapper);
		
		// Try to create grid - if it fails, use manual table
		try {
			// Check if Grid class exists
			if (typeof frappe.ui.form.Grid !== 'undefined') {
				let grid = new frappe.ui.form.Grid({
					doctype: "Travel Expense Detail",
					parent: temp_doc,
					parentfield: "expenses",
					frm: mock_frm,
					wrapper: grid_wrapper,
					controls: true,
					allow_bulk_edit: false,
				});
				
				// Store grid reference
				dialog.grid = grid;
				dialog.temp_doc = temp_doc;
				
				// Refresh the grid
				grid.refresh();
			} else {
				// Fallback: create a simple manual table
				create_manual_expense_table(dialog, temp_doc, table_wrapper);
			}
		} catch (e) {
			console.error("Error creating grid:", e);
			// Fallback: create a simple manual table
			create_manual_expense_table(dialog, temp_doc, table_wrapper);
		}
	});
}

function create_manual_expense_table(dialog, temp_doc, wrapper) {
	// Create a simple table structure as fallback
	let table_html = `
		<div class="form-section" style="width: 100%; max-width: 100%;">
			<div class="section-head">
				<span class="section-title">Expense Details</span>
				<button class="btn btn-sm btn-primary add-row" style="float: right;">
					<i class="fa fa-plus"></i> Add Row
				</button>
			</div>
			<div class="section-body" style="width: 100%; max-width: 100%;">
				<div class="expense-items-list" style="width: 100%; max-width: 100%;"></div>
			</div>
		</div>
	`;
	
	wrapper.html(table_html);
	
	// Add row button handler
	wrapper.find('.add-row').on('click', function() {
		add_expense_row(dialog, temp_doc, wrapper.find('.expense-items-list'));
	});
	
	// Add initial row
	add_expense_row(dialog, temp_doc, wrapper.find('.expense-items-list'));
}

function add_expense_row(dialog, temp_doc, container) {
	let row = frappe.model.add_child(temp_doc, "Travel Expense Detail", "expenses");
	let row_html = `
		<div class="expense-row" data-name="${row.name}" style="border: 1px solid #d1d8dd; padding: 15px; margin-bottom: 10px; border-radius: 4px;">
			<div class="row">
				<div class="col-md-4">
					<div class="form-group">
						<div class="expense-type-wrapper" data-field="expense_type"></div>
					</div>
				</div>
				<div class="col-md-4">
					<div class="form-group">
						<label>Date</label>
						<input type="date" class="form-control expense-date" data-field="expense_date" value="${frappe.datetime.get_today()}">
					</div>
				</div>
				<div class="col-md-4">
					<div class="form-group">
						<label class="amount-label">Amount</label>
						<input type="number" class="form-control expense-amount" data-field="amount" placeholder="0.00" step="0.01">
					</div>
				</div>
			</div>
			<!-- Hotel Fields (shown only when expense_type === 'Hotel') -->
			<div class="hotel-fields" style="display: none;">
				<div class="row">
					<div class="col-md-4">
						<div class="form-group">
							<label>Check-in Date</label>
							<input type="date" class="form-control hotel-checkin-date" data-field="hotel_checkin_date">
						</div>
					</div>
					<div class="col-md-4">
						<div class="form-group">
							<label>Check-out Date</label>
							<input type="date" class="form-control hotel-checkout-date" data-field="hotel_checkout_date">
						</div>
					</div>
					<div class="col-md-4">
						<div class="form-group">
							<label>Hotel Name</label>
							<input type="text" class="form-control" data-field="custom_hotel_name" placeholder="Hotel Name">
						</div>
					</div>
				</div>
				<div class="row">
					<div class="col-md-4">
						<div class="form-group">
							<div class="hotel-territory-wrapper" data-field="hotel_territory"></div>
						</div>
					</div>
					<div class="col-md-4">
						<div class="form-group">
							<div class="hotel-location-wrapper" data-field="hotel_location"></div>
						</div>
					</div>
					<div class="col-md-4">
						<div class="form-group">
							<label>Rate per Day</label>
							<input type="number" class="form-control" data-field="rate_per_day" placeholder="0.00" step="0.01">
						</div>
					</div>
				</div>
				<div class="row">
					<div class="col-md-6">
						<div class="form-group">
							<label>City<span style="color: red;">*</span></label>
							<input type="text" class="form-control hotel-city" data-field="hotel_city" placeholder="City" required>
						</div>
					</div>
					<div class="col-md-6">
						<div class="form-group">
							<div class="hotel-country-wrapper" data-field="hotel_country"></div>
					</div>
				</div>
			</div>
			<div class="row">
				<div class="col-md-12">
					<div class="form-group">
							<label>Purpose<span style="color: red;">*</span></label>
							<textarea class="form-control hotel-purpose" data-field="purpose" rows="2" placeholder="Purpose" required></textarea>
					</div>
				</div>
			</div>
			</div>
			<!-- Travel Fields (shown only when expense_type === 'Travel') -->
			<div class="travel-fields" style="display: none;">
			<div class="row">
					<div class="col-md-4">
					<div class="form-group">
							<label>PRN No<span class="prn-required-indicator" style="color: red;">*</span></label>
							<input type="text" class="form-control prn-number" data-field="custom_prn_number" placeholder="PRN Number">
					</div>
				</div>
					<div class="col-md-4">
					<div class="form-group">
							<div class="booked-by-wrapper" data-field="custom_booked_by"></div>
					</div>
				</div>
					<div class="col-md-4">
					<div class="form-group">
							<label>Date of Purchase</label>
							<input type="date" class="form-control" data-field="custom_date_of_purchase">
					</div>
				</div>
				</div>
				<div class="row">
					<div class="col-md-4">
					<div class="form-group">
							<div class="departure-airport-wrapper" data-field="custom_departure_airport"></div>
					</div>
				</div>
					<div class="col-md-4">
						<div class="form-group">
							<div class="arrival-airport-wrapper" data-field="custom_arrival_airport"></div>
			</div>
					</div>
					<div class="col-md-4">
						<div class="form-group">
							<div class="airlines-wrapper" data-field="custom_airlines"></div>
						</div>
					</div>
				</div>
				<div class="row">
					<div class="col-md-4">
						<div class="form-group">
							<div class="date-of-travel-wrapper" data-field="custom_date_of_travel"></div>
						</div>
					</div>
					<div class="col-md-4">
						<div class="form-group">
							<div class="date-of-arrival-wrapper" data-field="custom_date_of_arrival"></div>
						</div>
					</div>
					<div class="col-md-4">
						<div class="form-group">
							<label>Travel Type</label>
							<select class="form-control" data-field="custom_travel_type">
								<option value="">Select Travel Type</option>
								<option value="One Way">One Way</option>
								<option value="Return">Return</option>
							</select>
						</div>
					</div>
				</div>
			</div>
			<!-- Description (always visible, at the bottom) -->
			<div class="row">
				<div class="col-md-12">
					<div class="form-group">
						<label>Description</label>
						<textarea class="form-control expense-description" data-field="description" rows="2" placeholder="Description"></textarea>
					</div>
				</div>
			</div>
			<div class="row" style="margin-top: 10px; padding-top: 10px; border-top: 1px solid #e0e0e0;">
				<div class="col-md-12" style="text-align: right;">
					<button class="btn btn-sm btn-danger remove-row">
				<i class="fa fa-trash"></i> Remove
			</button>
				</div>
			</div>
		</div>
	`;
	
	let $row = $(row_html).appendTo(container);
	
	// Create Expense Type link field
	frappe.model.with_doctype("Expense Claim Type", function() {
		let expense_type_wrapper = $row.find('.expense-type-wrapper');
		let expense_type_field = frappe.ui.form.make_control({
			df: {
				fieldtype: "Link",
				fieldname: "expense_type",
				options: "Expense Claim Type",
				label: "Expense Type",
				reqd: 1
			},
			parent: expense_type_wrapper,
			render_input: true
		});
		
		expense_type_field.refresh();
		expense_type_field.set_value(row.expense_type || "");
		
		// Function to update conditional fields based on expense type
		function update_conditional_fields() {
			let selected_type = expense_type_field.get_value();
			if (selected_type) {
				frappe.model.set_value(row.doctype, row.name, "expense_type", selected_type);
				// Use the selected value directly (it's the name of the Expense Claim Type)
				toggle_conditional_fields($row, selected_type);
				
				// Auto-fill logic when Update or Refund is selected
				let expense_category = dialog.fields_dict && dialog.fields_dict.expense_category ? 
					dialog.fields_dict.expense_category.get_value() : "";
				
				// Update amount label based on category
				update_amount_label($row, expense_category);
				
				// Show/hide cash account field based on category
				update_cash_account_field($row, expense_category);
				
				if (expense_category === "Update" || expense_category === "Refund") {
					let selected_type_lower = (selected_type || "").toLowerCase();
					
					// Use setTimeout to ensure all fields are created before auto-filling
					setTimeout(function() {
						// Auto-fill hotel details
						if (selected_type_lower.includes("hotel")) {
							auto_fill_hotel_details(dialog, row, $row);
						}
						// Auto-fill travel details
						else if (selected_type_lower.includes("travel")) {
							auto_fill_travel_details(dialog, row, $row);
						}
					}, 300);
				}
			} else {
				// Hide all conditional fields if no expense type selected
				toggle_conditional_fields($row, "");
				update_cash_account_field($row, "");
			}
		}
		
		// Hook into the link field's value change
		// Frappe link fields trigger events when value is set via autocomplete
		expense_type_field.$input.on('change', function() {
			update_conditional_fields();
		});
		
		// Also listen when the link field's value is set programmatically
		let original_set_value = expense_type_field.set_value;
		expense_type_field.set_value = function(value) {
			original_set_value.call(this, value);
			setTimeout(update_conditional_fields, 50);
		};
		
		// Listen to the autocomplete selection event
		expense_type_field.$input.on('awesomplete-selectcomplete', function() {
			setTimeout(update_conditional_fields, 50);
		});
		
		// Listen to blur event
		expense_type_field.$input.on('blur', function() {
			setTimeout(update_conditional_fields, 50);
		});
		
		// Initial update if value exists
		if (row.expense_type) {
			setTimeout(function() {
				update_conditional_fields();
			}, 300);
		}
		
		// Removed per new design: lost amount will use expense type accounts, 
		// so we no longer show a separate Cash/Bank Account selector here.
	});
	
	// Create Hotel Territory link field
	frappe.model.with_doctype("Territory", function() {
		try {
			let hotel_territory_wrapper = $row.find('.hotel-territory-wrapper');
			let hotel_territory_field = frappe.ui.form.make_control({
				df: {
					fieldtype: "Link",
					fieldname: "hotel_territory",
					options: "Territory",
					label: "Hotel Territory"
				},
				parent: hotel_territory_wrapper,
				render_input: true
			});
			hotel_territory_field.refresh();
			hotel_territory_field.set_value(row.hotel_territory || "");
			
			// Store field reference on row element for later access
			$row.data('hotel_territory_field', hotel_territory_field);
			
			hotel_territory_field.$input.on('change blur', function() {
				let value = hotel_territory_field.get_value();
				frappe.model.set_value(row.doctype, row.name, "hotel_territory", value);
				// Force update locals
				if (locals[row.doctype] && locals[row.doctype][row.name]) {
					locals[row.doctype][row.name].hotel_territory = value;
				}
				// Also update the row object directly
				row.hotel_territory = value;
			});
		} catch(e) {
			console.warn("Could not create Hotel Territory link field:", e);
		}
	}, function() {
		// Doctype doesn't exist, skip
	});
	
	// Create Hotel Location link field
	frappe.model.with_doctype("Location", function() {
		try {
			let hotel_location_wrapper = $row.find('.hotel-location-wrapper');
			let hotel_location_field = frappe.ui.form.make_control({
				df: {
					fieldtype: "Link",
					fieldname: "hotel_location",
					options: "Location",
					label: "Hotel Location"
				},
				parent: hotel_location_wrapper,
				render_input: true
			});
			hotel_location_field.refresh();
			hotel_location_field.set_value(row.hotel_location || "");
			
			// Store field reference on row element for later access
			$row.data('hotel_location_field', hotel_location_field);
			
			hotel_location_field.$input.on('change blur', function() {
				let value = hotel_location_field.get_value();
				frappe.model.set_value(row.doctype, row.name, "hotel_location", value);
				// Force update locals
				if (locals[row.doctype] && locals[row.doctype][row.name]) {
					locals[row.doctype][row.name].hotel_location = value;
				}
				// Also update the row object directly
				row.hotel_location = value;
			});
		} catch(e) {
			console.warn("Could not create Hotel Location link field:", e);
		}
	}, function() {
		// Doctype doesn't exist, skip
	});
	
	// Create Hotel Country link field
	frappe.model.with_doctype("Country", function() {
		try {
			let hotel_country_wrapper = $row.find('.hotel-country-wrapper');
			let hotel_country_field = frappe.ui.form.make_control({
				df: {
					fieldtype: "Link",
					fieldname: "hotel_country",
					options: "Country",
					label: "Country",
					reqd: 1
				},
				parent: hotel_country_wrapper,
				render_input: true
			});
			hotel_country_field.refresh();
			hotel_country_field.set_value(row.hotel_country || "");
			
			// Store field reference on row element for later access
			$row.data('hotel_country_field', hotel_country_field);
			
			hotel_country_field.$input.on('change blur', function() {
				let value = hotel_country_field.get_value();
				frappe.model.set_value(row.doctype, row.name, "hotel_country", value);
				// Force update locals
				if (locals[row.doctype] && locals[row.doctype][row.name]) {
					locals[row.doctype][row.name].hotel_country = value;
				}
				// Also update the row object directly
				row.hotel_country = value;
			});
		} catch(e) {
			console.warn("Could not create Hotel Country link field:", e);
		}
	}, function() {
		// Doctype doesn't exist, skip
	});
	
	// Create Departure Airport link field
	frappe.model.with_doctype("Airport", function() {
		try {
			let dep_airport_wrapper = $row.find('.departure-airport-wrapper');
			let dep_airport_field = frappe.ui.form.make_control({
				df: {
					fieldtype: "Link",
					fieldname: "custom_departure_airport",
					options: "Airport",
					label: "Departure Airport"
				},
				parent: dep_airport_wrapper,
				render_input: true
			});
			dep_airport_field.refresh();
			dep_airport_field.set_value(row.custom_departure_airport || "");
			
			// Store field reference with both naming patterns
			$row.data('departure_airport_field', dep_airport_field);
			$row.data('custom_departure_airport_field', dep_airport_field);
			
			dep_airport_field.$input.on('change', function() {
				let value = dep_airport_field.get_value();
				frappe.model.set_value(row.doctype, row.name, "custom_departure_airport", value);
				row.custom_departure_airport = value;
			});
		} catch(e) {
			console.warn("Could not create Departure Airport link field:", e);
		}
	}, function() {
		// Doctype doesn't exist, skip
	});
	
	// Create Arrival Airport link field
	frappe.model.with_doctype("Airport", function() {
		try {
			let arr_airport_wrapper = $row.find('.arrival-airport-wrapper');
			let arr_airport_field = frappe.ui.form.make_control({
				df: {
					fieldtype: "Link",
					fieldname: "custom_arrival_airport",
					options: "Airport",
					label: "Arrival Airport"
				},
				parent: arr_airport_wrapper,
				render_input: true
			});
			arr_airport_field.refresh();
			arr_airport_field.set_value(row.custom_arrival_airport || "");
			
			// Store field reference with both naming patterns
			$row.data('arrival_airport_field', arr_airport_field);
			$row.data('custom_arrival_airport_field', arr_airport_field);
			
			arr_airport_field.$input.on('change', function() {
				let value = arr_airport_field.get_value();
				frappe.model.set_value(row.doctype, row.name, "custom_arrival_airport", value);
				row.custom_arrival_airport = value;
			});
		} catch(e) {
			console.warn("Could not create Arrival Airport link field:", e);
		}
	}, function() {
		// Doctype doesn't exist, skip
	});
	
	// Create Airlines link field
	frappe.model.with_doctype("Airlines", function() {
		try {
			let airlines_wrapper = $row.find('.airlines-wrapper');
			let airlines_field = frappe.ui.form.make_control({
				df: {
					fieldtype: "Link",
					fieldname: "custom_airlines",
					options: "Airlines",
					label: "Airlines"
				},
				parent: airlines_wrapper,
				render_input: true
			});
			airlines_field.refresh();
			airlines_field.set_value(row.custom_airlines || "");
			
			// Store field reference with both naming patterns
			$row.data('airlines_field', airlines_field);
			$row.data('custom_airlines_field', airlines_field);
			
			airlines_field.$input.on('change', function() {
				let value = airlines_field.get_value();
				frappe.model.set_value(row.doctype, row.name, "custom_airlines", value);
				row.custom_airlines = value;
			});
		} catch(e) {
			console.warn("Could not create Airlines link field:", e);
		}
	}, function() {
		// Doctype doesn't exist, skip
	});
	
	// Create Booked By link field
	frappe.model.with_doctype("Member", function() {
		try {
			let booked_by_wrapper = $row.find('.booked-by-wrapper');
			let booked_by_field = frappe.ui.form.make_control({
				df: {
					fieldtype: "Link",
					fieldname: "custom_booked_by",
					options: "Member",
					label: "Booked By"
				},
				parent: booked_by_wrapper,
				render_input: true
			});
			booked_by_field.refresh();
			booked_by_field.set_value(row.custom_booked_by || "");
			
			// Store field reference with both naming patterns
			$row.data('booked_by_field', booked_by_field);
			$row.data('custom_booked_by_field', booked_by_field);
			
			booked_by_field.$input.on('change blur', function() {
				let value = booked_by_field.get_value();
				frappe.model.set_value(row.doctype, row.name, "custom_booked_by", value);
				// Force update locals
				if (locals[row.doctype] && locals[row.doctype][row.name]) {
					locals[row.doctype][row.name].custom_booked_by = value;
				}
				// Also update the row object directly
				row.custom_booked_by = value;
			});
		} catch(e) {
			console.warn("Could not create Booked By link field:", e);
		}
	}, function() {
		// Doctype doesn't exist, skip
	});
	
	// Create Date of Travel datetime field
	try {
		let date_of_travel_wrapper = $row.find('.date-of-travel-wrapper');
		let date_of_travel_field = frappe.ui.form.make_control({
			df: {
				fieldtype: "Datetime",
				fieldname: "custom_date_of_travel",
				label: "Date of Travel"
			},
			parent: date_of_travel_wrapper,
			render_input: true
		});
		date_of_travel_field.refresh();
		if (row.custom_date_of_travel) {
			date_of_travel_field.set_value(row.custom_date_of_travel);
		}
		
		// Store field reference with both naming patterns
		$row.data('date_of_travel_field', date_of_travel_field);
		$row.data('custom_date_of_travel_field', date_of_travel_field);
		
		date_of_travel_field.$input.on('change', function() {
			let value = date_of_travel_field.get_value();
			frappe.model.set_value(row.doctype, row.name, "custom_date_of_travel", value);
			row.custom_date_of_travel = value;
		});
	} catch(e) {
		console.warn("Could not create Date of Travel field:", e);
	}
	
	// Create Date of Arrival datetime field
	try {
		let date_of_arrival_wrapper = $row.find('.date-of-arrival-wrapper');
		let date_of_arrival_field = frappe.ui.form.make_control({
			df: {
				fieldtype: "Datetime",
				fieldname: "custom_date_of_arrival",
				label: "Date of Arrival"
			},
			parent: date_of_arrival_wrapper,
			render_input: true
		});
		date_of_arrival_field.refresh();
		if (row.custom_date_of_arrival) {
			date_of_arrival_field.set_value(row.custom_date_of_arrival);
		}
		
		// Store field reference with both naming patterns
		$row.data('date_of_arrival_field', date_of_arrival_field);
		$row.data('custom_date_of_arrival_field', date_of_arrival_field);
		
		date_of_arrival_field.$input.on('change', function() {
			let value = date_of_arrival_field.get_value();
			frappe.model.set_value(row.doctype, row.name, "custom_date_of_arrival", value);
			row.custom_date_of_arrival = value;
		});
	} catch(e) {
		console.warn("Could not create Date of Arrival field:", e);
	}
	
	// Function to calculate total nights and amount for Hotel expenses
	// Note: All calculations in modal are in transaction currency
	// Currency conversion will happen when data is added to Travel Expense child table
	function calculate_hotel_totals() {
		let expense_type = row.expense_type || "";
		let expense_type_lower = expense_type.toLowerCase().trim();
		
		if (expense_type_lower === 'hotel' || expense_type_lower.includes('hotel')) {
			let checkin_date = $row.find('.hotel-checkin-date').val();
			let checkout_date = $row.find('.hotel-checkout-date').val();
			// Use rate_per_day in transaction currency (no conversion in modal)
			let rate_per_day = row.rate_per_day || parseFloat($row.find('input[data-field="rate_per_day"]').val()) || 0;
			
			// Calculate total nights
			let total_nights = 0;
			if (checkin_date && checkout_date) {
				let checkin = new Date(checkin_date);
				let checkout = new Date(checkout_date);
				if (checkout > checkin) {
					let diff_time = checkout - checkin;
					total_nights = Math.ceil(diff_time / (1000 * 60 * 60 * 24));
				}
			}
			
			// Update total nights in row data
			frappe.model.set_value(row.doctype, row.name, "total_nights", total_nights);
			
			// Calculate amount = rate_per_day × total_nights (both in transaction currency)
			let calculated_amount = rate_per_day * total_nights;
			// Always update amount, even if 0
			frappe.model.set_value(row.doctype, row.name, "amount", calculated_amount);
			// Update the amount field in the UI
			$row.find('input[data-field="amount"]').val(calculated_amount.toFixed(2));
			row.amount = calculated_amount;
			
			// Update locals
			if (locals[row.doctype] && locals[row.doctype][row.name]) {
				locals[row.doctype][row.name].amount = calculated_amount;
			}
		}
	}
	
	// Store calculate_hotel_totals function on row element for external access
	$row.data('calculate-hotel-totals', calculate_hotel_totals);
	
	// Helper function to convert rate_per_day from transaction currency to company currency
	function convert_rate_per_day(dialog, $row, row, transaction_rate) {
		// Get transaction currency from dialog - try multiple methods
		let transaction_currency = null;
		if (dialog.fields_dict && dialog.fields_dict.transaction_currency) {
			transaction_currency = dialog.fields_dict.transaction_currency.get_value();
		} else if (dialog.get_value) {
			transaction_currency = dialog.get_value('transaction_currency');
		} else {
			// Try to get from dialog wrapper
			let currency_field = dialog.$wrapper.find('[data-fieldname="transaction_currency"]');
			if (currency_field.length) {
				transaction_currency = currency_field.val();
			}
		}
		
		let company_currency = dialog.company_currency;
		
		if (!transaction_currency || !company_currency) {
			// If currency info not available, use rate as is
			frappe.model.set_value(row.doctype, row.name, "rate_per_day", transaction_rate);
			row.rate_per_day = transaction_rate;
			row.converted_rate_per_day = transaction_rate;
			return;
		}
		
		// If currencies are the same, no conversion needed
		if (transaction_currency === company_currency) {
			frappe.model.set_value(row.doctype, row.name, "rate_per_day", transaction_rate);
			row.rate_per_day = transaction_rate;
			row.converted_rate_per_day = transaction_rate;
			// Recalculate hotel totals with the rate
			calculate_hotel_totals();
			return;
		}
		
		// Get transaction date for exchange rate
		let transaction_date = $row.find('input[data-field="expense_date"]').val() || frappe.datetime.get_today();
		let company = dialog.original_frm ? dialog.original_frm.doc.company : null;
		
		if (!company) {
			// If company not available, use rate as is
			frappe.model.set_value(row.doctype, row.name, "rate_per_day", transaction_rate);
			row.rate_per_day = transaction_rate;
			row.converted_rate_per_day = transaction_rate;
			return;
		}
		
		// Convert currency
		frappe.call({
			method: "erpnext.setup.utils.get_exchange_rate",
			args: {
				from_currency: transaction_currency,
				to_currency: company_currency,
				transaction_date: transaction_date,
				company: company
			},
			callback: function(rate_result) {
				if (rate_result.message) {
					let exchange_rate = rate_result.message;
					let converted_rate = transaction_rate * exchange_rate;
					
					// Update rate_per_day with converted value (in company currency)
					frappe.model.set_value(row.doctype, row.name, "rate_per_day", converted_rate);
					row.rate_per_day = converted_rate;
					row.converted_rate_per_day = converted_rate;
					
					// Update the input field value in UI
					$row.find('input[data-field="rate_per_day"]').val(converted_rate.toFixed(2));
					
					// Also update locals
					if (locals[row.doctype] && locals[row.doctype][row.name]) {
						locals[row.doctype][row.name].rate_per_day = converted_rate;
					}
					
					// Recalculate hotel totals with the converted rate
					calculate_hotel_totals();
					
					// Show conversion info
					frappe.show_alert(
						__("Rate converted: {0} {1} = {2} {3}", [
							transaction_rate.toFixed(2),
							transaction_currency,
							converted_rate.toFixed(2),
							company_currency
						]),
						2,
						"blue"
					);
				} else {
					// If exchange rate not found, use original rate
					frappe.model.set_value(row.doctype, row.name, "rate_per_day", transaction_rate);
					row.rate_per_day = transaction_rate;
					row.converted_rate_per_day = transaction_rate;
					calculate_hotel_totals();
				}
			},
			error: function(err) {
				// On error, use original rate
				frappe.model.set_value(row.doctype, row.name, "rate_per_day", transaction_rate);
				row.rate_per_day = transaction_rate;
				row.converted_rate_per_day = transaction_rate;
				calculate_hotel_totals();
			}
		});
	}
	
	// Bind input handlers to update the row data
	$row.find('input, textarea, select').on('change', function() {
		let field = $(this).data('field');
		let value = $(this).val();
		if (field) {
			frappe.model.set_value(row.doctype, row.name, field, value);
		}
		
		// Calculate hotel totals when check-in, check-out changes
		// Note: rate_per_day conversion is handled separately
		if ($(this).hasClass('hotel-checkin-date') || 
		    $(this).hasClass('hotel-checkout-date')) {
			calculate_hotel_totals();
		}
	});
	
	// Handle rate_per_day field (Hotel expenses) - NO currency conversion in modal
	// Just update value and calculate amount in transaction currency
	// Currency conversion will happen when data is added to Travel Expense child table
	$row.find('input[data-field="rate_per_day"]').on('change blur', function() {
		let $rate_input = $(this);
		let transaction_rate = parseFloat($rate_input.val()) || 0;
		
		// Check if this is a hotel expense
		let expense_type = row.expense_type || "";
		let expense_type_lower = expense_type.toLowerCase().trim();
		if (expense_type_lower !== 'hotel' && !expense_type_lower.includes('hotel')) {
			return;
		}
		
		// Update row data with the new rate (in transaction currency)
		row.rate_per_day = transaction_rate;
		frappe.model.set_value(row.doctype, row.name, "rate_per_day", transaction_rate);
		
		// Recalculate hotel totals (amount = rate_per_day × total_nights in transaction currency)
		calculate_hotel_totals();
	});
	
	// Handle amount field - convert to company currency when entered
	$row.find('input[data-field="amount"]').on('change blur', function() {
		let $amount_input = $(this);
		let transaction_amount = parseFloat($amount_input.val()) || 0;
		
		if (transaction_amount === 0) {
			return;
		}
		
		// Get transaction currency from dialog
		let transaction_currency = null;
		if (dialog.fields_dict && dialog.fields_dict.transaction_currency) {
			transaction_currency = dialog.fields_dict.transaction_currency.get_value();
		} else if (dialog.get_value) {
			transaction_currency = dialog.get_value('transaction_currency');
		}
		
		let company_currency = dialog.company_currency;
		
		if (!transaction_currency || !company_currency) {
			// If currencies not available, just store the amount
			frappe.model.set_value(row.doctype, row.name, "amount", transaction_amount);
			row.amount = transaction_amount;
			return;
		}
		
		// If currencies are the same, no conversion needed
		if (transaction_currency === company_currency) {
			frappe.model.set_value(row.doctype, row.name, "amount", transaction_amount);
			row.amount = transaction_amount;
			row.amount_company_currency = transaction_amount;
			return;
		}
		
		// Get transaction date for exchange rate
		let transaction_date = $row.find('input[data-field="expense_date"]').val() || frappe.datetime.get_today();
		let company = dialog.original_frm ? dialog.original_frm.doc.company : null;
		
		if (!company) {
			frappe.model.set_value(row.doctype, row.name, "amount", transaction_amount);
			row.amount = transaction_amount;
			return;
		}
		
		// Convert currency
		frappe.call({
			method: "erpnext.setup.utils.get_exchange_rate",
			args: {
				from_currency: transaction_currency,
				to_currency: company_currency,
				transaction_date: transaction_date,
				company: company
			},
			callback: function(rate_result) {
				if (rate_result.message) {
					let exchange_rate = rate_result.message;
					let converted_amount = transaction_amount * exchange_rate;
					
					// Store transaction currency amount
					frappe.model.set_value(row.doctype, row.name, "amount", transaction_amount);
					row.amount = transaction_amount;
					
					// Store company currency amount
					row.amount_company_currency = converted_amount;
					
					// Update locals
					if (locals[row.doctype] && locals[row.doctype][row.name]) {
						locals[row.doctype][row.name].amount = transaction_amount;
						locals[row.doctype][row.name].amount_company_currency = converted_amount;
					}
				} else {
					// If conversion fails, just store the amount
					frappe.model.set_value(row.doctype, row.name, "amount", transaction_amount);
					row.amount = transaction_amount;
				}
			}
		});
	});
	
	$row.data('calculate-hotel-totals', calculate_hotel_totals);
	
	// Remove row handler
	$row.find('.remove-row').on('click', function() {
		frappe.model.remove_from_locals(row.doctype, row.name);
		$row.remove();
	});
}

// Flight lookup for modal rows
function lookup_flight_for_modal_row(dialog, $row, row, flight_number) {
	if (!flight_number || !flight_number.trim()) {
		return;
	}
	
	frappe.show_alert(__("Looking up flight information..."), 3);
	
	frappe.call({
		method: "nextlayer.next_layer.api.aerodata_utils.get_flight_details",
		args: {
			flight_number: flight_number.trim(),
		},
		callback: function (r) {
			if (r.message) {
				const result = r.message;
				
				if (result.success) {
					show_flight_confirmation_modal_for_row(dialog, $row, row, result.data, flight_number.trim());
				} else {
					frappe.show_alert(
						__("Failed to fetch flight details: ") + (result.error || "Unknown error"),
						5,
						"red"
					);
					
					frappe.msgprint({
						title: __("Flight Lookup Failed"),
						message: __(`
							<div style="padding: 10px;">
								<p><strong>Flight Number:</strong> ${flight_number}</p>
								<p><strong>Error:</strong> ${result.error || "Unknown error"}</p>
								${result.error_details ? `<p><strong>Details:</strong> ${result.error_details}</p>` : ""}
							</div>
						`),
						indicator: "red",
					});
				}
			}
		},
		error: function() {
			frappe.show_alert(__("Error looking up flight information."), 5, "red");
		}
	});
}

// Show flight confirmation modal for modal row
function show_flight_confirmation_modal_for_row(dialog, $row, row, flight_data, flight_number_searched) {
	if (!flight_data || (Array.isArray(flight_data) && flight_data.length === 0)) {
		frappe.msgprint({
			title: __("No Flight Found"),
			message: __("No flight information found for the provided number."),
			indicator: "orange",
		});
		return;
	}
	
	let flights = Array.isArray(flight_data) ? flight_data : [flight_data];
	
	const first_flight = flights[0];
	const last_flight = flights[flights.length - 1];
	
	// Extract flight information
	const airline = first_flight.airline || {};
	const departure = first_flight.departure || {};
	const arrival = last_flight.arrival || {};
	
	const dep_airport = departure.airport || {};
	const arr_airport = arrival.airport || {};
	
	const dep_scheduled = departure.scheduledTime || {};
	const arr_scheduled = arrival.scheduledTime || {};
	
	// Format datetimes for display
	const dep_datetime_display = dep_scheduled.local || "";
	const arr_datetime_display = arr_scheduled.local || "";
	
	// Build route display
	let route_display = `${dep_airport.iata || "N/A"} → ${arr_airport.iata || "N/A"}`;
	if (flights.length > 1) {
		let route_parts = [];
		flights.forEach((flight) => {
			let dep = flight.departure?.airport?.iata || "";
			let arr = flight.arrival?.airport?.iata || "";
			if (dep && arr) {
				route_parts.push(`${dep} → ${arr}`);
			}
		});
		route_display = route_parts.join(" → ");
	}
	
	// Build HTML for flight details
	let flight_info_html = `
		<div style="padding: 15px;">
			<h3 style="margin-top: 0;">✈️ Flight Information</h3>
			<div style="background: #f5f5f5; padding: 15px; border-radius: 5px; margin-bottom: 15px;">
				<p><strong>Flight:</strong> ${flight_number_searched}</p>
				<p><strong>Airline:</strong> ${airline.name || "N/A"}</p>
				<p><strong>Route:</strong> ${route_display}</p>
				<p><strong>From:</strong> ${dep_airport.name || dep_airport.shortName || "N/A"} (${dep_airport.iata || "N/A"})</p>
				<p><strong>To:</strong> ${arr_airport.name || arr_airport.shortName || "N/A"} (${arr_airport.iata || "N/A"})</p>
				<p><strong>Departure:</strong> ${dep_datetime_display || "N/A"}</p>
				<p><strong>Arrival:</strong> ${arr_datetime_display || "N/A"}</p>
			</div>
			<div style="padding: 10px; background: #fff3cd; border-radius: 5px;">
				<p style="margin: 0;"><strong>Is this the correct flight information?</strong></p>
				<p style="margin: 5px 0 0 0; font-size: 12px; color: #666;">Click "Confirm" to auto-fill the travel fields.</p>
			</div>
		</div>
	`;
	
	// Create confirmation modal
	let d = new frappe.ui.Dialog({
		title: __("Confirm Flight Information"),
		fields: [
			{
				fieldtype: "HTML",
				fieldname: "flight_info",
				options: flight_info_html,
			},
		],
		primary_action_label: __("Confirm"),
		primary_action: function (values) {
			fill_travel_fields_for_modal_row(dialog, $row, row, flights, dep_airport, arr_airport, airline, dep_scheduled, arr_scheduled);
			d.hide();
		},
		secondary_action_label: __("Cancel"),
		secondary_action: function () {
			d.hide();
		},
	});
	
	d.show();
}

// Fill travel fields for modal row
function fill_travel_fields_for_modal_row(dialog, $row, row, flights, dep_airport, arr_airport, airline, dep_scheduled, arr_scheduled) {
	// Extract airport information
	let dep_airport_name = dep_airport.name || dep_airport.shortName || "";
	let dep_airport_iata = dep_airport.iata || "";
	let dep_airport_icao = dep_airport.icao || "";
	let dep_airport_city = dep_airport.municipalityName || "";
	let dep_airport_country = dep_airport.countryCode || "";
	
	let arr_airport_name = arr_airport.name || arr_airport.shortName || "";
	let arr_airport_iata = arr_airport.iata || "";
	let arr_airport_icao = arr_airport.icao || "";
	let arr_airport_city = arr_airport.municipalityName || "";
	let arr_airport_country = arr_airport.countryCode || "";
	
	// Extract airline information
	let airline_name = airline.name || "";
	let airline_iata = airline.iata || "";
	let airline_icao = airline.icao || "";
	
	// Format datetime helper (reuse from existing function)
	function format_datetime_for_frappe(datetime_str) {
		if (!datetime_str) return null;
		try {
			let cleaned = datetime_str.trim();
			cleaned = cleaned.replace(/[+-]\d{2}:?\d{2}\s*$/, '');
			if (cleaned.includes('T')) {
				cleaned = cleaned.replace('T', ' ');
			}
			let parts = cleaned.trim().split(/\s+/);
			if (parts.length < 2) {
				let match = cleaned.match(/^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}(?::\d{2})?)/);
				if (match) {
					parts = [match[1], match[2]];
				} else {
					return null;
				}
			}
			let date_part = parts[0];
			let time_part = parts[1];
			if (time_part.includes('.')) {
				time_part = time_part.split('.')[0];
			}
			if (time_part.match(/^\d{2}:\d{2}$/)) {
				time_part = time_part + ':00';
			}
			let formatted = date_part + ' ' + time_part;
			if (formatted.match(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)) {
				return formatted;
			}
			return null;
		} catch (e) {
			return null;
		}
	}
	
	let dep_datetime = null;
	let arr_datetime = null;
	
	if (dep_scheduled.local) {
		dep_datetime = format_datetime_for_frappe(dep_scheduled.local);
	}
	
	if (arr_scheduled.local) {
		arr_datetime = format_datetime_for_frappe(arr_scheduled.local);
	}
	
	// Show loading message
	frappe.show_alert(__("Creating/updating airline and airport records..."), 3);
	
	// Create/get airline and airports, then fill the fields
	let promises = [];
	
	// Get or create airline
	if (airline_name) {
		promises.push(
			frappe.call({
				method: "nextlayer.next_layer.api.flight_utils.get_or_create_airline",
				args: {
					airline_name: airline_name,
					airline_iata: airline_iata,
					airline_icao: airline_icao,
				},
			})
		);
	} else {
		promises.push(Promise.resolve({ message: null }));
	}
	
	// Get or create departure airport
	if (dep_airport_name) {
		promises.push(
			frappe.call({
				method: "nextlayer.next_layer.api.flight_utils.get_or_create_airport",
				args: {
					airport_name: dep_airport_name,
					airport_iata: dep_airport_iata,
					airport_icao: dep_airport_icao,
					airport_city: dep_airport_city,
					airport_country: dep_airport_country,
				},
			})
		);
	} else {
		promises.push(Promise.resolve({ message: null }));
	}
	
	// Get or create arrival airport
	if (arr_airport_name) {
		promises.push(
			frappe.call({
				method: "nextlayer.next_layer.api.flight_utils.get_or_create_airport",
				args: {
					airport_name: arr_airport_name,
					airport_iata: arr_airport_iata,
					airport_icao: arr_airport_icao,
					airport_city: arr_airport_city,
					airport_country: arr_airport_country,
				},
			})
		);
	} else {
		promises.push(Promise.resolve({ message: null }));
	}
	
	// Wait for all API calls to complete
	Promise.all(promises).then(function(results) {
		let airline_record = results[0].message || null;
		let dep_airport_record = results[1].message || null;
		let arr_airport_record = results[2].message || null;
		
		// Fill in the flight details with linked records
		if (dep_airport_record) {
			frappe.model.set_value(row.doctype, row.name, "custom_departure_airport", dep_airport_record);
			// Update link field control if it exists
			let dep_field = $row.data('departure_airport_field');
			if (dep_field) {
				dep_field.set_value(dep_airport_record);
			}
		}
		
		if (arr_airport_record) {
			frappe.model.set_value(row.doctype, row.name, "custom_arrival_airport", arr_airport_record);
			// Update link field control if it exists
			let arr_field = $row.data('arrival_airport_field');
			if (arr_field) {
				arr_field.set_value(arr_airport_record);
			}
		}
		
		if (airline_record) {
			frappe.model.set_value(row.doctype, row.name, "custom_airlines", airline_record);
			// Update link field control if it exists
			let airline_field = $row.data('airlines_field');
			if (airline_field) {
				airline_field.set_value(airline_record);
			}
		}
		
		if (dep_datetime) {
			frappe.model.set_value(row.doctype, row.name, "custom_date_of_travel", dep_datetime);
			// Update datetime field control if it exists
			let travel_date_field = $row.data('date_of_travel_field');
			if (travel_date_field) {
				travel_date_field.set_value(dep_datetime);
			}
		}
		
		if (arr_datetime) {
			frappe.model.set_value(row.doctype, row.name, "custom_date_of_arrival", arr_datetime);
			// Update datetime field control if it exists
			let arrival_date_field = $row.data('date_of_arrival_field');
			if (arrival_date_field) {
				arrival_date_field.set_value(arr_datetime);
			}
		}
		
		frappe.show_alert(__("Flight information filled successfully!"), 3, "green");
	}).catch(function(error) {
		frappe.show_alert(__("Error creating airline/airport records. Please check manually."), 5, "red");
		frappe.log_error(error, "Flight Fill Error");
	});
}

function update_amount_label($row, expense_category) {
	// Update the amount label based on expense category
	let $label = $row.find('.amount-label');
	if (expense_category === "Refund") {
		$label.text("Refund Amount");
	} else {
		$label.text("Amount");
	}
}

function update_cash_account_field($row, expense_category) {
	// Show/hide cash account field based on expense category
	let $cash_account_field = $row.find('.cash-account-field');
	if (expense_category === "Refund") {
		$cash_account_field.show();
	} else {
		$cash_account_field.hide();
	}
}

function toggle_conditional_fields($row, expense_type) {
	// Hide all conditional fields first
	$row.find('.hotel-fields').hide();
	$row.find('.travel-fields').hide();
	
	// Show fields based on expense_type (case-insensitive comparison)
	if (expense_type) {
		let expense_type_lower = expense_type.toLowerCase().trim();
		// Check if expense type is "Hotel" (exact match or contains hotel)
		if (expense_type_lower === 'hotel' || expense_type_lower.includes('hotel')) {
			$row.find('.hotel-fields').show();
			// Trigger calculation after showing fields
			setTimeout(function() {
				let calc_func = $row.data('calculate-hotel-totals');
				if (calc_func) calc_func();
			}, 100);
		}
		// Check if expense type is "Travel" (exact match or contains travel)
		if (expense_type_lower === 'travel' || expense_type_lower.includes('travel')) {
			$row.find('.travel-fields').show();
		}
	}
}

function create_additional_travel_expense(original_frm, dialog, temp_doc) {
	// Get expense items from the grid
	let expense_items = [];
	
	if (temp_doc.expenses && temp_doc.expenses.length > 0) {
		temp_doc.expenses.forEach(function(row) {
			if (row.expense_type) {
				// Refresh row from locals to get latest values
				let row_name = row.name;
				if (row_name && locals['Travel Expense Detail'] && locals['Travel Expense Detail'][row_name]) {
					row = locals['Travel Expense Detail'][row_name];
				}
				
				// Get row element to read link field values if not in row object
				let $row_element = dialog.$wrapper.find(`.expense-row[data-name="${row_name}"]`);
				
				// Helper to get value from row or link field control
				function get_field_value(fieldname) {
					// First check row object
					let value = row[fieldname];
					
					// If value is not in row, try to get from link field control
					if (!value && $row_element.length) {
						// Try different field reference patterns
						let field_control = $row_element.data(`${fieldname}_field`) || 
						                      $row_element.data(fieldname.replace('custom_', '') + '_field');
						
						if (field_control && typeof field_control.get_value === 'function') {
							try {
								value = field_control.get_value();
								// Update row with the value
								if (value) {
									row[fieldname] = value;
									// Also update locals
									if (locals[row.doctype] && locals[row.doctype][row.name]) {
										locals[row.doctype][row.name][fieldname] = value;
									}
								}
							} catch(e) {
								console.warn(`Error getting value for ${fieldname}:`, e);
							}
						} else {
							// Try to read directly from the input field
							let field_wrapper = $row_element.find(`[data-field="${fieldname}"]`);
							if (field_wrapper.length) {
								let input = field_wrapper.find('input').first();
								if (input.length) {
									value = input.val();
									if (value) {
										row[fieldname] = value;
										// Also update locals
										if (locals[row.doctype] && locals[row.doctype][row.name]) {
											locals[row.doctype][row.name][fieldname] = value;
										}
									}
								}
							}
						}
					}
					return value || null;
				}
				
				// Calculate total nights and amount for Hotel expenses before collecting data
				let expense_type_lower = (row.expense_type || "").toLowerCase().trim();
				if (expense_type_lower === 'hotel' || expense_type_lower.includes('hotel')) {
					// Calculate total nights from check-in and check-out dates
					if (row.hotel_checkin_date && row.hotel_checkout_date) {
						let checkin = new Date(row.hotel_checkin_date);
						let checkout = new Date(row.hotel_checkout_date);
						if (checkout > checkin) {
							let diff_time = checkout - checkin;
							let total_nights = Math.ceil(diff_time / (1000 * 60 * 60 * 24));
							row.total_nights = total_nights;
							
							// Calculate amount = rate_per_day × total_nights
							let rate_per_day = parseFloat(row.rate_per_day) || 0;
							if (rate_per_day > 0 && total_nights > 0) {
								row.amount = rate_per_day * total_nights;
							}
						}
					}
				}
				
				// Get amount - use row.amount (which should be in transaction currency)
				let amount = row.amount || 0;
				
				// Get company currency amount if available (should be set when amount was entered)
				let amount_company_currency = row.amount_company_currency || null;
				
				// If amount_company_currency is not set but we have amount and currencies are different, convert now
				if (!amount_company_currency && amount > 0) {
					let transaction_currency = dialog.fields_dict && dialog.fields_dict.transaction_currency ? 
						dialog.fields_dict.transaction_currency.get_value() : 
						(dialog.original_frm.doc.currency || dialog.company_currency);
					let company_currency = dialog.company_currency;
					
					if (transaction_currency && company_currency && transaction_currency !== company_currency) {
						// We'll let the server do the conversion since we don't have exchange rate here
						// Just pass the amount and transaction currency
					} else {
						// Same currency, set amount_company_currency = amount
						amount_company_currency = amount;
					}
				}
				
				let item = {
					expense_type: row.expense_type,
					expense_date: row.expense_date || frappe.datetime.get_today(),
					amount: amount,  // Use transaction currency amount
					amount_company_currency: amount_company_currency,  // Pass company currency amount if available
					sanctioned_amount: row.sanctioned_amount || amount || 0,
					cost_center: row.cost_center,
					project: row.project,
					company: row.company || original_frm.doc.company,
					receipt: row.receipt,
					description: row.description,
					// PRN Number
					custom_prn_number: row.custom_prn_number,
					// Hotel fields - use helper to get link field values
					hotel_checkin_date: row.hotel_checkin_date,
					hotel_checkout_date: row.hotel_checkout_date,
					purpose: row.purpose,
					hotel_territory: get_field_value('hotel_territory'),
					hotel_location: get_field_value('hotel_location'),
					hotel_city: row.hotel_city,
					hotel_country: row.hotel_country,
					custom_hotel_name: row.custom_hotel_name,
					total_nights: row.total_nights,
					rate_per_day: row.rate_per_day,
					// Travel custom fields
					custom_flight_no: row.custom_flight_no,
					custom_date_of_purchase: row.custom_date_of_purchase,
					custom_travel_type: row.custom_travel_type,
					custom_booked_by: get_field_value('custom_booked_by'),
					custom_departure_airport: get_field_value('custom_departure_airport'),
					custom_arrival_airport: get_field_value('custom_arrival_airport'),
					custom_airlines: get_field_value('custom_airlines'),
					custom_date_of_travel: get_field_value('custom_date_of_travel'),
					custom_date_of_arrival: get_field_value('custom_date_of_arrival'),
				};
				expense_items.push(item);
			}
		});
	}
	
	if (expense_items.length === 0) {
		frappe.msgprint({
			title: __("No Expenses"),
			message: __("Please add at least one expense item."),
			indicator: "orange",
		});
		return;
	}
	
	// Validate fields based on expense type
	for (let i = 0; i < expense_items.length; i++) {
		let item = expense_items[i];
		if (item.expense_type) {
			let expense_type_lower = (item.expense_type || "").toLowerCase().trim();
			
			// Validate Travel expense type
			if ((expense_type_lower === 'travel' || expense_type_lower.includes('travel'))) {
				let prn_number = item.custom_prn_number;
				if (!prn_number || (typeof prn_number === 'string' && prn_number.trim() === '')) {
					frappe.msgprint({
						title: __("Validation Error"),
						message: __("PRN Number is mandatory when Expense Type is Travel."),
						indicator: "red",
					});
					return;
				}
			}
			
			// Validate Hotel expense type
			if ((expense_type_lower === 'hotel' || expense_type_lower.includes('hotel'))) {
				// Check City
				let hotel_city = item.hotel_city;
				if (!hotel_city || (typeof hotel_city === 'string' && hotel_city.trim() === '')) {
					frappe.msgprint({
						title: __("Validation Error"),
						message: __("City is mandatory when Expense Type is Hotel."),
						indicator: "red",
					});
					return;
				}
				
				// Check Country
				let hotel_country = item.hotel_country;
				if (!hotel_country || (typeof hotel_country === 'string' && hotel_country.trim() === '')) {
					frappe.msgprint({
						title: __("Validation Error"),
						message: __("Country is mandatory when Expense Type is Hotel."),
						indicator: "red",
					});
					return;
				}
				
				// Check Purpose
				let purpose = item.purpose;
				if (!purpose || (typeof purpose === 'string' && purpose.trim() === '')) {
					frappe.msgprint({
						title: __("Validation Error"),
						message: __("Purpose is mandatory when Expense Type is Hotel."),
						indicator: "red",
					});
					return;
				}
			}
		}
	}
	
	// Show loading
	frappe.show_alert(__("Creating additional travel expense..."), 3);
	
	// Get transaction currency, expense category, and cash account from dialog
	let transaction_currency = dialog.fields_dict && dialog.fields_dict.transaction_currency ? 
		dialog.fields_dict.transaction_currency.get_value() : 
		(original_frm.doc.currency || dialog.company_currency);
	
	let expense_category = dialog.fields_dict && dialog.fields_dict.expense_category ? 
		dialog.fields_dict.expense_category.get_value() : "";
	
	// Get cash account from dialog (stored when user selects in any row) or from first row's field
	let cash_account = dialog.cash_account || null;
	if (!cash_account) {
		// Try to get from first expense row's cash account field
		let first_row = dialog.$wrapper.find('.expense-row').first();
		if (first_row.length) {
			let cash_account_field = first_row.data('cash_account_field');
			if (cash_account_field && typeof cash_account_field.get_value === 'function') {
				cash_account = cash_account_field.get_value();
			}
		}
	}
	
	// Create new travel expense
	frappe.call({
		method: "nextlayer.next_layer.api.travel_expense_utils.create_additional_travel_expense",
		args: {
			original_travel_expense: original_frm.doc.name,
			expense_items: expense_items,
			company: original_frm.doc.company,
			traveler_name: original_frm.doc.traveler_name,
			transaction_currency: transaction_currency,
			expense_category: expense_category,
			cash_account: cash_account,
		},
		callback: function(r) {
			if (r.message) {
				if (r.message.success) {
					frappe.show_alert(__("Added to More Information on this Travel Expense."), 5, "green");
					dialog.hide();
					// Stay on the same Travel Expense and refresh so More Information tab shows new rows
					original_frm.reload_doc();
				} else {
					frappe.msgprint({
						title: __("Error"),
						message: r.message.error || __("Failed to create additional travel expense"),
						indicator: "red",
					});
				}
			}
		},
		error: function(r) {
			frappe.msgprint({
				title: __("Error"),
				message: __("An error occurred while creating the additional travel expense."),
				indicator: "red",
			});
		}
	});
}

// Create Journal Entry - Create journal entry if it doesn't exist
function create_journal_entry_for_travel_expense(frm) {
	if (frm.doc.is_cancelled) {
		frappe.msgprint({
			title: __("Cannot Create Journal Entry"),
			message: __("Cannot create journal entry for a cancelled travel expense."),
			indicator: "orange"
		});
		return;
	}
	
	if (frm.doc.docstatus !== 1) {
		frappe.msgprint({
			title: __("Document Not Submitted"),
			message: __("Please submit the travel expense before creating journal entry."),
			indicator: "orange"
		});
		return;
	}
	
	frappe.confirm(
		__("Are you sure you want to create a journal entry for this travel expense?"),
		function() {
			// Yes - proceed with journal entry creation
			frappe.call({
				method: "nextlayer.next_layer.api.travel_expense_utils.check_and_create_journal_entry",
				args: {
					travel_expense_name: frm.doc.name
				},
				freeze: true,
				freeze_message: __("Creating journal entry..."),
				callback: function(r) {
					if (r.message) {
						if (r.message.success) {
							if (r.message.already_exists) {
								frappe.msgprint({
									title: __("Journal Entry Already Exists"),
									message: __("Journal Entry {0} already exists for this travel expense.", [r.message.journal_entry_name || ""]),
									indicator: "blue"
								});
							} else {
								frappe.show_alert({
									message: __("Journal Entry {0} created and submitted successfully.", [r.message.journal_entry_name || ""]),
									indicator: "green"
								}, 5);
							}
							frm.reload_doc();
						} else {
							frappe.msgprint({
								title: __("Error"),
								message: r.message.error || __("Failed to create journal entry."),
								indicator: "red"
							});
						}
					}
				},
				error: function(r) {
					frappe.msgprint({
						title: __("Error"),
						message: __("An error occurred while creating journal entry."),
						indicator: "red"
					});
				}
			});
		},
		function() {
			// No - do nothing
		}
	);
}

// Cancel Charges - Create reverse journal entry and mark as cancelled
function cancel_travel_expense_charges(frm) {
	if (frm.doc.is_cancelled) {
		frappe.msgprint({
			title: __("Already Cancelled"),
			message: __("This travel expense has already been cancelled."),
			indicator: "orange"
		});
		return;
	}
	
	frappe.confirm(
		__("Are you sure you want to cancel the charges for this travel expense? This will create a reverse journal entry and mark the expense as cancelled."),
		function() {
			// Yes - proceed with cancellation
			frappe.call({
				method: "nextlayer.next_layer.api.travel_expense_utils.cancel_travel_expense_charges",
				args: {
					travel_expense_name: frm.doc.name
				},
				freeze: true,
				freeze_message: __("Cancelling charges and creating reverse journal entry..."),
				callback: function(r) {
					if (r.message) {
						if (r.message.success) {
							frappe.show_alert({
								message: __("Charges cancelled successfully. Reverse journal entry {0} created.", [r.message.journal_entry_name || ""]),
								indicator: "green"
							}, 5);
							frm.reload_doc();
						} else {
							frappe.msgprint({
								title: __("Error"),
								message: r.message.error || __("Failed to cancel charges."),
								indicator: "red"
							});
						}
					}
				},
				error: function(r) {
					frappe.msgprint({
						title: __("Error"),
						message: __("An error occurred while cancelling charges."),
						indicator: "red"
					});
				}
			});
		},
		function() {
			// No - do nothing
		}
	);
}

// Function to recalculate all expense amounts in company currency
function recalculate_all_expense_amounts_company_currency(frm) {
	if (!frm.doc.expenses || frm.doc.expenses.length === 0) {
		return;
	}
	
	frm.doc.expenses.forEach(function(expense) {
		if (expense.amount) {
			convert_expense_amount_to_company_currency(frm, "Travel Expense Detail", expense.name);
		}
	});
}

// Function to convert expense amount to company currency
// IMPORTANT: This function ONLY updates amount_company_currency, it does NOT touch the amount field
function convert_expense_amount_to_company_currency(frm, cdt, cdn) {
	if (!frm.doc.company || !frm.doc.currency || !frm.doc.posting_date) {
		return;
	}
	
	let row = locals[cdt][cdn];
	if (!row) {
		return;
	}
	
	// Get the transaction currency amount (this is what the user entered)
	let transaction_amount = parseFloat(row.amount) || 0;
	
	if (transaction_amount === 0) {
		frappe.model.set_value(cdt, cdn, "amount_company_currency", 0);
		return;
	}
	
	// Ensure amount field is not overwritten - it should always be transaction currency
	// If somehow it got changed, restore it
	if (row.amount !== transaction_amount && transaction_amount > 0) {
		frappe.model.set_value(cdt, cdn, "amount", transaction_amount);
	}
	
	let transaction_currency = frm.doc.currency;
	
	// Get company currency
	frappe.db.get_value("Company", frm.doc.company, "default_currency", function(r) {
		if (!r || !r.default_currency) {
			return;
		}
		
		let company_currency = r.default_currency;
		
		// If currencies are the same, no conversion needed
		if (transaction_currency === company_currency) {
			frappe.model.set_value(cdt, cdn, "amount_company_currency", transaction_amount);
			return;
		}
		
		// Get exchange rate and convert
		let transaction_date = frm.doc.posting_date || frappe.datetime.get_today();
		
		frappe.call({
			method: "erpnext.setup.utils.get_exchange_rate",
			args: {
				from_currency: transaction_currency,
				to_currency: company_currency,
				transaction_date: transaction_date,
				company: frm.doc.company
			},
			callback: function(rate_result) {
				if (rate_result.message) {
					let exchange_rate = rate_result.message;
					let converted_amount = transaction_amount * exchange_rate;
					// ONLY update amount_company_currency, never touch amount field
					frappe.model.set_value(cdt, cdn, "amount_company_currency", converted_amount);
				} else {
					// If exchange rate not found, use original transaction amount
					frappe.model.set_value(cdt, cdn, "amount_company_currency", transaction_amount);
				}
			},
			error: function() {
				// On error, use original transaction amount
				frappe.model.set_value(cdt, cdn, "amount_company_currency", transaction_amount);
			}
		});
	});
}

// Function to calculate totals from child tables
function calculate_totals(frm) {
	// Calculate total from expenses child table (transaction currency)
	let total = 0;
	let total_company_currency = 0;
	if (frm.doc.expenses && frm.doc.expenses.length > 0) {
		frm.doc.expenses.forEach(function(expense) {
			if (expense.amount) {
				total += parseFloat(expense.amount) || 0;
			}
			if (expense.amount_company_currency) {
				total_company_currency += parseFloat(expense.amount_company_currency) || 0;
			}
		});
	}
	
	// Calculate total taxes and charges (transaction currency)
	let total_taxes_and_charges = 0;
	if (frm.doc.taxes_and_charges && frm.doc.taxes_and_charges.length > 0) {
		frm.doc.taxes_and_charges.forEach(function(tax) {
			if (tax.tax_amount) {
				total_taxes_and_charges += parseFloat(tax.tax_amount) || 0;
			}
		});
	}
	
	// Convert taxes to company currency
	let total_taxes_and_charges_company_currency = 0;
	let transaction_currency = frm.doc.currency;
	
	if (frm.doc.company && transaction_currency && total_taxes_and_charges > 0) {
		frappe.db.get_value("Company", frm.doc.company, "default_currency", function(r) {
			if (r && r.default_currency) {
				let company_currency = r.default_currency;
				if (transaction_currency === company_currency) {
					total_taxes_and_charges_company_currency = total_taxes_and_charges;
				} else {
					// Convert tax amount
					let transaction_date = frm.doc.posting_date || frappe.datetime.get_today();
					frappe.call({
						method: "erpnext.setup.utils.get_exchange_rate",
						args: {
							from_currency: transaction_currency,
							to_currency: company_currency,
							transaction_date: transaction_date,
							company: frm.doc.company
						},
						callback: function(rate_result) {
							if (rate_result.message) {
								let exchange_rate = rate_result.message;
								total_taxes_and_charges_company_currency = total_taxes_and_charges * exchange_rate;
							} else {
								total_taxes_and_charges_company_currency = total_taxes_and_charges;
							}
							// Update totals after conversion
							update_totals_fields(frm, total, total_company_currency, total_taxes_and_charges, total_taxes_and_charges_company_currency);
						},
						error: function() {
							total_taxes_and_charges_company_currency = total_taxes_and_charges;
							update_totals_fields(frm, total, total_company_currency, total_taxes_and_charges, total_taxes_and_charges_company_currency);
						}
					});
					return; // Exit early, will update in callback
				}
			}
			// Update totals (synchronous update)
			update_totals_fields(frm, total, total_company_currency, total_taxes_and_charges, total_taxes_and_charges_company_currency);
		});
	} else {
		// Update totals (synchronous update)
		update_totals_fields(frm, total, total_company_currency, total_taxes_and_charges, total_taxes_and_charges_company_currency);
	}
}

// Helper function to update totals fields
function update_totals_fields(frm, total, total_company_currency, total_taxes_and_charges, total_taxes_and_charges_company_currency) {
	// Calculate grand totals
	let grand_total = total + total_taxes_and_charges;
	let grand_total_company_currency = total_company_currency + total_taxes_and_charges_company_currency;
	
	// Update fields
	frm.set_value("total", total);
	frm.set_value("total_company_currency", total_company_currency);
	frm.set_value("total_taxes_and_charges", total_taxes_and_charges);
	frm.set_value("total_taxes_and_charges_company_currency", total_taxes_and_charges_company_currency);
	frm.set_value("grand_total", grand_total);
	frm.set_value("grand_total_company_currency", grand_total_company_currency);
	
	// Refresh fields to update UI
	frm.refresh_field("total");
	frm.refresh_field("total_company_currency");
	frm.refresh_field("total_taxes_and_charges");
	frm.refresh_field("total_taxes_and_charges_company_currency");
	frm.refresh_field("grand_total");
	frm.refresh_field("grand_total_company_currency");
}
