// Copyright (c) 2025, Next Layer and contributors
// For license information, please see license.txt

// Track lookup status to prevent multiple simultaneous lookups
let flight_lookup_in_progress = false;

frappe.ui.form.on("Expense Claim", {
	custom_flight_no: function(frm) {
		if (frm.doc.custom_flight_no && frm.doc.custom_flight_no.trim()) {
			lookup_flight_for_expense_claim(frm);
		}
	},
	
	refresh: function(frm) {
		// Add event listener to flight number field for Enter key
		if (frm.fields_dict.custom_flight_no) {
			frm.fields_dict.custom_flight_no.$input.on('keydown', function(e) {
				if (e.keyCode === 13) {
					e.preventDefault();
					if (frm.doc.custom_flight_no && frm.doc.custom_flight_no.trim()) {
						if (!flight_lookup_in_progress) {
							lookup_flight_for_expense_claim(frm);
						}
					}
				}
			});
		}
	}
});

// Handle flight lookup from child table (Expense Claim Detail)
frappe.ui.form.on("Expense Claim Detail", {
	custom_flight_no: function(frm, cdt, cdn) {
		let row = locals[cdt][cdn];
		if (row.custom_flight_no && row.custom_flight_no.trim()) {
			lookup_flight_for_expense_claim_detail(frm, row, cdn);
		}
	},
	
	refresh: function(frm) {
		// Add event listener to flight number field in the grid for Enter key
		if (frm.fields_dict.expenses && frm.fields_dict.expenses.grid) {
			frm.fields_dict.expenses.grid.wrapper.on('keydown', 'input[data-fieldname="custom_flight_no"]', function(e) {
				if (e.keyCode === 13) {
					e.preventDefault();
					let row_name = $(this).closest('.grid-row').attr('data-name');
					if (row_name) {
						let row = locals['Expense Claim Detail'][row_name];
						if (row && row.custom_flight_no && row.custom_flight_no.trim()) {
							lookup_flight_for_expense_claim_detail(frm, row, row_name);
						}
					}
				}
			});
		}
	}
});

function lookup_flight_for_expense_claim(frm) {
	let flight_number = frm.doc.custom_flight_no ? frm.doc.custom_flight_no.trim() : "";
	
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

function lookup_flight_for_expense_claim_detail(frm, row, row_key) {
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
							<p style="margin: 5px 0 0 0; font-size: 12px; color: #666;">Click "Confirm" to auto-fill the expense claim with origin (${dep_airport.iata || "N/A"}) to final destination (${arr_airport.iata || "N/A"}).</p>
						</div>
					</div>
				`,
			},
		],
		primary_action_label: __("Confirm"),
		primary_action: function (values) {
			// Auto-fill the expense claim detail fields
			// Pass all flights to handle multi-leg journeys
			// If target_row is provided, fill that specific row; otherwise find/create Travel row
			fill_expense_claim_fields(frm, flights, dep_airport, arr_airport, airline, dep_scheduled, arr_scheduled, target_row);
			d.hide();
		},
		secondary_action_label: __("Cancel"),
		secondary_action: function () {
			d.hide();
		},
	});
	
	d.show();
}

function fill_expense_claim_fields(frm, flights, dep_airport, arr_airport, airline, dep_scheduled, arr_scheduled, target_row) {
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
			// Remove timezone offset - match patterns like +04:00, -03:00, +0300, -0500
			// Use a more explicit regex that matches at the end of string
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
		
		// Fill in the flight details with linked records
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
		
		frappe.show_alert(__("Flight information filled successfully!"), 3, "green");
		
		// Refresh the form to show updated values
		frm.refresh_field("expenses");
	}).catch(function(error) {
		frappe.show_alert(__("Error creating airline/airport records. Please check manually."), 5, "red");
		frappe.log_error(error, "Flight Fill Error");
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
