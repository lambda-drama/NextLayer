// Copyright (c) 2025, Next Layer and contributors
// For license information, please see license.txt

// Track lookup status to prevent multiple simultaneous lookups
let travel_expense_flight_lookup_in_progress = false;

frappe.ui.form.on("Travel Expense", {
	flight_no: function(frm) {
		if (frm.doc.flight_no && frm.doc.flight_no.trim()) {
			lookup_flight_for_travel_expense(frm);
		}
	},
	
	before_save: function(frm) {
		// Transfer travel details from main doctype to child table if expense type is Travel
		if (frm.doc.expenses && frm.doc.expenses.length > 0) {
			frm.doc.expenses.forEach(function(row) {
				// Check if expense type is Travel (case-insensitive)
				if (row.expense_type && row.expense_type.toLowerCase().includes("travel")) {
					// Field mapping: main doctype -> child table
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
				}
			});
		}
	},
	
	refresh: function(frm) {
		// Add event listener to flight number field for Enter key
		if (frm.fields_dict.flight_no && frm.fields_dict.flight_no.$input) {
			// Remove existing listeners to avoid duplicates
			frm.fields_dict.flight_no.$input.off('keydown');
			frm.fields_dict.flight_no.$input.on('keydown', function(e) {
				if (e.keyCode === 13) {
					e.preventDefault();
					if (frm.doc.flight_no && frm.doc.flight_no.trim()) {
						if (!travel_expense_flight_lookup_in_progress) {
							lookup_flight_for_travel_expense(frm);
						}
					}
				}
			});
		}
	}
});

function lookup_flight_for_travel_expense(frm) {
	let flight_number = frm.doc.flight_no ? frm.doc.flight_no.trim() : "";
	
	if (!flight_number) {
		return;
	}
	
	// Skip if lookup is already in progress
	if (travel_expense_flight_lookup_in_progress) {
		return;
	}
	
	// Mark lookup as in progress
	travel_expense_flight_lookup_in_progress = true;
	
	frappe.show_alert(__("Looking up flight information..."), 3);
	
	frappe.call({
		method: "nextlayer.next_layer.api.aerodata_utils.get_flight_details",
		args: {
			flight_number: flight_number,
		},
		callback: function (r) {
			// Clear lookup flag
			travel_expense_flight_lookup_in_progress = false;
			
			if (r.message) {
				const result = r.message;
				
				if (result.success) {
					// Show flight details modal for user confirmation
					show_flight_confirmation_modal_travel_expense(frm, result.data, flight_number);
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
			travel_expense_flight_lookup_in_progress = false;
		}
	});
}

function show_flight_confirmation_modal_travel_expense(frm, flight_data, flight_number_searched) {
	// Parse flight data
	let flights = Array.isArray(flight_data.flights) ? flight_data.flights : [flight_data];
	
	if (flights.length === 0) {
		frappe.msgprint({
			title: __("No Flight Data"),
			message: __("No flight information found for the given flight number."),
			indicator: "orange",
		});
		return;
	}
	
	// Get first flight for display
	let flight = flights[0];
	let dep = flight.departure || {};
	let arr = flight.arrival || {};
	let airline = flight.airline || {};
	let dep_airport = dep.airport || {};
	let arr_airport = arr.airport || {};
	let dep_scheduled = dep.scheduled || {};
	let arr_scheduled = arr.scheduled || {};
	
	// Format datetime for display
	let dep_datetime_display = dep_scheduled.local || dep_scheduled.utc || "N/A";
	let arr_datetime_display = arr_scheduled.local || arr_scheduled.utc || "N/A";
	
	// Build route display
	let route_parts = [];
	if (dep_airport.iata) route_parts.push(dep_airport.iata);
	if (arr_airport.iata) route_parts.push(arr_airport.iata);
	let route_display = route_parts.length > 0 ? route_parts.join(" → ") : "N/A";
	
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
				<p><strong>Departure:</strong> ${dep_datetime_display}</p>
				<p><strong>Arrival:</strong> ${arr_datetime_display}</p>
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
			// Auto-fill the travel expense fields
			fill_travel_expense_fields(frm, flights, dep_airport, arr_airport, airline, dep_scheduled, arr_scheduled);
			d.hide();
		},
		secondary_action_label: __("Cancel"),
		secondary_action: function () {
			d.hide();
		},
	});
	
	d.show();
}

function fill_travel_expense_fields(frm, flights, dep_airport, arr_airport, airline, dep_scheduled, arr_scheduled) {
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
		
		// Fill in the flight details in main doctype
		if (dep_airport_record) {
			frm.set_value("custom_departure_airport", dep_airport_record);
		}
		
		if (arr_airport_record) {
			frm.set_value("custom_arrival_airport", arr_airport_record);
		}
		
		if (airline_record) {
			frm.set_value("custom_airlines", airline_record);
		}
		
		if (dep_datetime) {
			frm.set_value("custom_date_of_travel", dep_datetime);
		}
		
		if (arr_datetime) {
			frm.set_value("custom_date_of_arrival", arr_datetime);
		}
		
		// Also update child table if there are travel expenses
		if (frm.doc.expenses && frm.doc.expenses.length > 0) {
			frm.doc.expenses.forEach(function(row) {
				if (row.expense_type && row.expense_type.toLowerCase().includes("travel")) {
					if (dep_airport_record) {
						frappe.model.set_value(row.doctype, row.name, "custom_departure_airport", dep_airport_record);
					}
					if (arr_airport_record) {
						frappe.model.set_value(row.doctype, row.name, "custom_arrival_airport", arr_airport_record);
					}
					if (airline_record) {
						frappe.model.set_value(row.doctype, row.name, "custom_airlines", airline_record);
					}
					if (dep_datetime) {
						frappe.model.set_value(row.doctype, row.name, "custom_date_of_travel", dep_datetime);
					}
					if (arr_datetime) {
						frappe.model.set_value(row.doctype, row.name, "custom_date_of_arrival", arr_datetime);
					}
				}
			});
		}
		
		frappe.show_alert(__("Flight information filled successfully!"), 3, "green");
		
		// Refresh the form to show updated values
		frm.refresh();
	}).catch(function(error) {
		frappe.show_alert(__("Error creating airline/airport records. Please check manually."), 5, "red");
		frappe.log_error(error, "Travel Expense Flight Fill Error");
	});
}



