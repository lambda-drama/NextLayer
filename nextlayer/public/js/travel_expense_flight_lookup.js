// Copyright (c) 2025, Next Layer and contributors
// For license information, please see license.txt

// Track lookup status to prevent multiple simultaneous lookups
let flight_lookup_in_progress = false;

frappe.ui.form.on("Travel Expense", {
	travel_amount: function(frm) {
		convert_and_update_amount(frm);
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
		
		// Set company filter for payable_account when company changes
		if (frm.doc.company) {
			frm.set_query("payable_account", function() {
				return {
					filters: {
						company: frm.doc.company
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
		// Recalculate conversion when posting date changes (exchange rate might be different)
		if (frm.doc.travel_amount && frm.doc.currency) {
			convert_and_update_amount(frm);
		}
		recalculate_all_expense_amounts_company_currency(frm);
		calculate_totals(frm);
	},
	
	is_paid: function(frm) {
		// Show/hide mode_of_payment and set payable_account requirement based on is_paid
		if (frm.doc.is_paid) {
			frm.set_df_property("mode_of_payment", "reqd", 1);
			frm.set_df_property("payable_account", "reqd", 0);
		} else {
			frm.set_df_property("mode_of_payment", "reqd", 0);
			frm.set_df_property("payable_account", "reqd", 1);
		}
		frm.refresh_field("mode_of_payment");
		frm.refresh_field("payable_account");
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
	},
	
	refresh: function(frm) {
		// Set initial requirements based on is_paid
		// Payable account is always visible, just mandatory when is_paid is not ticked
		if (frm.doc.is_paid) {
			frm.set_df_property("mode_of_payment", "reqd", 1);
			frm.set_df_property("payable_account", "reqd", 0);
		} else {
			frm.set_df_property("mode_of_payment", "reqd", 0);
			frm.set_df_property("payable_account", "reqd", 1);
		}
		frm.refresh_field("mode_of_payment");
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
		
		// Add "Additional Expenses" button
		if (!frm.is_new()) {
			frm.add_custom_button(__("Additional Expenses"), function() {
				show_additional_expenses_modal(frm);
			}, __("Actions"));
		}
	},
	
	before_save: function(frm) {
		// Calculate totals before save
		calculate_totals(frm);
		// Count travel expenses
		let travel_count = 0;
		if (frm.doc.expenses && frm.doc.expenses.length > 0) {
			frm.doc.expenses.forEach(function(row) {
				if (row.expense_type && row.expense_type.toLowerCase().includes("travel")) {
					travel_count++;
				}
			});
		}
		
		if (travel_count === 0 && frm.doc.travel_amount) {
			let amount_transaction = frm.doc.travel_amount || 0;
			let amount_company = frm.doc.amountcompany_currency || 0;
			
			// If amountcompany_currency is not set, convert it
			if (!amount_company || amount_company === 0) {
				if (frm.doc.company && frm.doc.currency) {
					frappe.db.get_value("Company", frm.doc.company, "default_currency", function(r) {
						if (r && r.default_currency) {
							let company_currency = r.default_currency;
							if (frm.doc.currency === company_currency) {
								amount_company = amount_transaction;
							} else {
								amount_company = amount_transaction;
							}
						}
					});
				} else {
					amount_company = amount_transaction; 
				}
			}
			
			// Create a new travel expense row
			let travel_row = frm.add_child("expenses");
			travel_row.expense_type = "Travel";
			travel_row.amount = amount_transaction; 
			travel_row.amount_company_currency = amount_company; 
			travel_row.sanctioned_amount = amount_company || amount_transaction;
			travel_row.expense_date = frm.doc.posting_date || frappe.datetime.get_today();
			
			// Set the values using frappe.model.set_value
			frappe.model.set_value(travel_row.doctype, travel_row.name, "expense_type", "Travel");
			frappe.model.set_value(travel_row.doctype, travel_row.name, "amount", amount_transaction);
			frappe.model.set_value(travel_row.doctype, travel_row.name, "amount_company_currency", amount_company);
			frappe.model.set_value(travel_row.doctype, travel_row.name, "sanctioned_amount", amount_company || amount_transaction);
			if (frm.doc.posting_date) {
				frappe.model.set_value(travel_row.doctype, travel_row.name, "expense_date", frm.doc.posting_date);
			}
			
			// Convert to company currency if needed
			if (frm.doc.company && frm.doc.currency && frm.doc.posting_date) {
				convert_expense_amount_to_company_currency(frm, travel_row.doctype, travel_row.name);
			}
		}
		
		// Transfer travel details from main doctype to child table if expense type is Travel
		if (frm.doc.expenses && frm.doc.expenses.length > 0) {
			frm.doc.expenses.forEach(function(row) {
				// Check if expense type is Travel (case-insensitive)
				if (row.expense_type && row.expense_type.toLowerCase().includes("travel")) {
					// Field mapping: main doctype -> child table
					// Note: main doctype has custom_pnr_number_ (with underscore), child table has custom_prn_number
					let field_mappings = [
						{ main: "custom_departure_airport", child: "custom_departure_airport" },
						{ main: "custom_arrival_airport", child: "custom_arrival_airport" },
						{ main: "custom_airlines", child: "custom_airlines" },
						{ main: "custom_date_of_travel", child: "custom_date_of_travel" },
						{ main: "custom_date_of_arrival", child: "custom_date_of_arrival" },
						{ main: "custom_date_of_purchase", child: "custom_date_of_purchase" },
						{ main: "custom_booked_by", child: "custom_booked_by" },
						{ main: "custom_travel_type", child: "custom_travel_type" },
						{ main: "custom_pnr_number_", child: "custom_prn_number" }, // Note: different field names
					];
					
					// Transfer values if child table field is missing/empty and main doctype has value
					field_mappings.forEach(function(mapping) {
						let main_value = frm.doc[mapping.main];
						let child_value = row[mapping.child];
						
						// If child field is missing/empty and main has value, transfer it
						if ((!child_value || child_value === "" || child_value === null) && main_value) {
							row[mapping.child] = main_value;
							frappe.model.set_value(row.doctype, row.name, mapping.child, main_value);
						}
					});
					
					// Update amount with travel_amount (transaction currency)
					// Update amount_company_currency with amountcompany_currency (company currency)
					if (frm.doc.travel_amount) {
						frappe.model.set_value(row.doctype, row.name, "amount", frm.doc.travel_amount);
					}
					
					if (frm.doc.amountcompany_currency) {
						frappe.model.set_value(row.doctype, row.name, "amount_company_currency", frm.doc.amountcompany_currency);
						frappe.model.set_value(row.doctype, row.name, "sanctioned_amount", frm.doc.amountcompany_currency);
					} else if (frm.doc.travel_amount) {
						// If amountcompany_currency is not set, convert it
						convert_expense_amount_to_company_currency(frm, row.doctype, row.name);
						// Use travel_amount as fallback for sanctioned_amount
						frappe.model.set_value(row.doctype, row.name, "sanctioned_amount", frm.doc.travel_amount);
					}
				}
			});
		}
	},
	
	refresh: function(frm) {
		// Calculate totals on refresh
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
		
		// Add "Additional Expenses" button after submit (only show if document is submitted)
		if (frm.doc.docstatus === 1) {
			frm.add_custom_button(__("Additional Expenses"), function() {
				show_additional_expenses_modal(frm);
			}, __("Create"));
		}
	}
});

// Handle flight lookup from child table (Travel Expense Detail)
frappe.ui.form.on("Travel Expense Detail", {
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
	
	if (!flight_number) {
		return;
	}
	
	// Skip if lookup is already in progress
	if (flight_lookup_in_progress) {
		return;
	}
	
	// Mark lookup as in progress
	flight_lookup_in_progress = true;
	
	frappe.show_alert(__("Looking up flight information..."), 3);
	
	frappe.call({
		method: "nextlayer.next_layer.api.aerodata_utils.get_flight_details",
		args: {
			flight_number: flight_number,
		},
		callback: function (r) {
			// Clear lookup flag
			flight_lookup_in_progress = false;
			
			if (r.message) {
				const result = r.message;
				
				if (result.success) {
					// Show flight details modal for user confirmation (for main form - finds/creates Travel row)
					show_flight_confirmation_modal(frm, result.data, flight_number, null);
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

function lookup_flight_for_travel_expense_detail(frm, row, row_key) {
	let flight_number = row.custom_flight_no ? row.custom_flight_no.trim() : "";
	
	if (!flight_number) {
		return;
	}
	
	// Skip if lookup is already in progress for this row
	if (flight_lookup_in_progress === row_key) {
		return;
	}
	
	// Mark lookup as in progress
	flight_lookup_in_progress = row_key;
	
	frappe.show_alert(__("Looking up flight information..."), 3);
	
	frappe.call({
		method: "nextlayer.next_layer.api.aerodata_utils.get_flight_details",
		args: {
			flight_number: flight_number,
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

function show_flight_confirmation_modal(frm, flight_data, flight_number_searched, target_row) {
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
	
	// Create modal to show flight details and ask for confirmation
	let d = new frappe.ui.Dialog({
		title: __("Confirm Flight Information"),
		fields: [
			{
				fieldtype: "HTML",
				fieldname: "flight_info",
				options: `
					<div style="padding: 15px; max-width: 900px;">
						<h3 style="margin-top: 0;">✈️ Flight Information (${flights.length} flight leg(s))</h3>
						
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
							<p style="margin: 5px 0 0 0; font-size: 12px; color: #666;">Click "Confirm" to auto-fill the travel expense with origin (${dep_airport.iata || "N/A"}) to final destination (${arr_airport.iata || "N/A"}).</p>
						</div>
					</div>
				`,
			},
		],
		primary_action_label: __("Confirm"),
		primary_action: function (values) {
			// Auto-fill the travel expense detail fields
			// Pass all flights to handle multi-leg journeys
			// If target_row is provided, fill that specific row; otherwise find/create Travel row
			fill_travel_expense_fields(frm, flights, dep_airport, arr_airport, airline, dep_scheduled, arr_scheduled, target_row);
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
			// Same currency, use amount directly
			update_travel_row_amount(frm, travel_amount);
			// Set amountcompany_currency to the same value
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
					// Update travel row with converted amount (in company currency)
					update_travel_row_amount(frm, travel_amount);
					
					// Update amountcompany_currency field with converted amount
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
					// If exchange rate not found, use original amount
					update_travel_row_amount(frm, travel_amount);
					// Set amountcompany_currency to original amount (assuming same currency if no rate found)
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
				// On error, use original amount
				update_travel_row_amount(frm, travel_amount);
				// Set amountcompany_currency to original amount
				frm.set_value("amountcompany_currency", travel_amount);
				frm.refresh_field("amountcompany_currency");
			}
		});
	});
}

// Helper function to update travel row amount in child table
function update_travel_row_amount(frm, converted_amount) {
	if (!frm.doc.expenses || frm.doc.expenses.length === 0) {
		return;
	}
	
	// Find travel expense row
	let travel_row = null;
	for (let i = 0; i < frm.doc.expenses.length; i++) {
		let row = frm.doc.expenses[i];
		if (row.expense_type && row.expense_type.toLowerCase().includes("travel")) {
			travel_row = row;
			break;
		}
	}
	
	// If no travel row found, create one
	if (!travel_row) {
		travel_row = frm.add_child("expenses");
		travel_row.expense_type = "Travel";
		travel_row.expense_date = frm.doc.posting_date || frappe.datetime.get_today();
		frappe.model.set_value(travel_row.doctype, travel_row.name, "expense_type", "Travel");
		if (frm.doc.posting_date) {
			frappe.model.set_value(travel_row.doctype, travel_row.name, "expense_date", frm.doc.posting_date);
		}
	}
	
	// Update amount and sanctioned_amount
	frappe.model.set_value(travel_row.doctype, travel_row.name, "amount", converted_amount);
	frappe.model.set_value(travel_row.doctype, travel_row.name, "sanctioned_amount", converted_amount);
	
	// Refresh the expenses field to show updated values
	frm.refresh_field("expenses");
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
				fieldtype: "Link",
				fieldname: "transaction_currency",
				label: __("Transaction Currency"),
				options: "Currency",
				default: frm.doc.currency || company_currency,
				reqd: 1
			},
			{
				fieldtype: "HTML",
				fieldname: "expense_table",
				options: `
					<div id="additional_expenses_table" style="min-height: 500px; margin-bottom: 20px;">
						<!-- Travel Expense Detail table will be rendered here -->
					</div>
				`,
			},
		],
		primary_action_label: __("Create Travel Expense"),
		primary_action: function(values) {
			// Get checkbox value from custom footer
			let create_journal_entry = d.$wrapper.find('#create_journal_entry_checkbox').is(':checked');
			create_additional_travel_expense(frm, d, temp_doc, create_journal_entry);
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
	
	// Add checkbox to footer on the left side of buttons
	setTimeout(function() {
		let footer = d.$wrapper.find('.modal-footer');
		if (footer.length) {
			let checkbox_html = `
				<div style="float: left; margin-top: 8px;">
					<label style="font-weight: normal; margin: 0; cursor: pointer;">
						<input type="checkbox" id="create_journal_entry_checkbox" checked style="margin-right: 5px;">
						${__("Create Journal Entry")}
					</label>
				</div>
			`;
			footer.prepend(checkbox_html);
		}
	}, 100);
	
	// Initialize the child table after dialog is shown
	setTimeout(function() {
		initialize_additional_expenses_table(d, temp_doc);
		
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
												frappe.model.set_value(row.doctype, row.name, "amount", converted_amount);
												row.amount = converted_amount;
												amount_input.val(converted_amount.toFixed(2));
												
												// Update locals
												if (locals[row.doctype] && locals[row.doctype][row.name]) {
													locals[row.doctype][row.name].amount = converted_amount;
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
		// Create grid wrapper
		let grid_wrapper = $('<div class="form-grid"></div>').appendTo(table_wrapper);
		
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
		<div class="form-section">
			<div class="section-head">
				<span class="section-title">Expense Details</span>
				<button class="btn btn-sm btn-primary add-row" style="float: right;">
					<i class="fa fa-plus"></i> Add Row
				</button>
			</div>
			<div class="section-body">
				<div class="expense-items-list"></div>
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
						<label>Amount</label>
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
			} else {
				// Hide all conditional fields if no expense type selected
				toggle_conditional_fields($row, "");
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
	frappe.model.with_doctype("User", function() {
		try {
			let booked_by_wrapper = $row.find('.booked-by-wrapper');
			let booked_by_field = frappe.ui.form.make_control({
				df: {
					fieldtype: "Link",
					fieldname: "custom_booked_by",
					options: "User",
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
	
	// Handle amount field - NO currency conversion in modal
	// Just update value in transaction currency
	// Currency conversion will happen when data is added to Travel Expense child table
	$row.find('input[data-field="amount"]').on('change blur', function() {
		let $amount_input = $(this);
		let transaction_amount = parseFloat($amount_input.val()) || 0;
		
		// Update amount in transaction currency (no conversion in modal)
		frappe.model.set_value(row.doctype, row.name, "amount", transaction_amount);
		row.amount = transaction_amount;
		
		// Update locals
		if (locals[row.doctype] && locals[row.doctype][row.name]) {
			locals[row.doctype][row.name].amount = transaction_amount;
		}
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

function create_additional_travel_expense(original_frm, dialog, temp_doc, create_journal_entry = false) {
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
				
				let item = {
					expense_type: row.expense_type,
					expense_date: row.expense_date || frappe.datetime.get_today(),
					amount: row.amount || 0,
					sanctioned_amount: row.sanctioned_amount || row.amount || 0,
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
	
	// Create new travel expense
	frappe.call({
		method: "nextlayer.next_layer.api.travel_expense_utils.create_additional_travel_expense",
		args: {
			original_travel_expense: original_frm.doc.name,
			expense_items: expense_items,
			company: original_frm.doc.company,
			traveler_name: original_frm.doc.traveler_name,
			create_journal_entry: create_journal_entry || false,
		},
		callback: function(r) {
			if (r.message) {
				if (r.message.success) {
					let message = __("Additional travel expense created successfully!");
					if (r.message.journal_entry_name) {
						message += " " + __("Journal Entry {0} has been created and submitted.", [r.message.journal_entry_name]);
					}
					frappe.show_alert(message, 5, "green");
					dialog.hide();
					
					// Open the new travel expense
					frappe.set_route("Form", "Travel Expense", r.message.travel_expense_name);
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
