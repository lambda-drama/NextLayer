// Copyright (c) 2025, Next Layer and contributors
// For license information, please see license.txt

frappe.ui.form.on("Aviation Stack Settings", {
	refresh: function (frm) {
		// Add button to lookup flight information
		frm.add_custom_button(
			__("Lookup Flight"),
			function () {
				lookup_flight_modal(frm);
			},
			__("Actions")
		).addClass("btn-primary");

		// Add button to test API connection
		frm.add_custom_button(
			__("Test Connection"),
			function () {
				test_aviation_stack_connection(frm);
			},
			__("Actions")
		).addClass("btn-info");
	},
});

function lookup_flight_modal(frm) {
	// Create modal dialog for flight lookup
	let d = new frappe.ui.Dialog({
		title: __("Lookup Flight Information"),
		fields: [
			{
				fieldtype: "Section Break",
				label: __("Flight Information"),
			},
			{
				fieldtype: "Data",
				fieldname: "flight_number",
				label: __("Flight Number"),
				description: __(
					"<strong>Use the Flight Number from your booking (e.g., D3189, D3186)</strong><br>" +
					"<span style='color: #666;'>Note: Use flight numbers like 'D3189', NOT booking reference (J6HRDK) or ticket number (9915000320139)</span>"
				),
				reqd: 1,
			},
			{
				fieldtype: "Date",
				fieldname: "flight_date",
				label: __("Flight Date"),
				description: __(
					"<strong>Recommended:</strong> Enter the flight date (e.g., 2025-12-18) to get accurate results. " +
					"Some flights may not be found without a date."
				),
			},
			{
				fieldtype: "Column Break",
			},
			{
				fieldtype: "Small Text",
				fieldname: "multiple_flights",
				label: __("Multiple Flights (Optional)"),
				description: __(
					"Enter multiple flight numbers separated by commas (e.g., D3189, D3186) to lookup multiple flights at once."
				),
			},
			{
				fieldtype: "Section Break",
				label: __("Help"),
			},
			{
				fieldtype: "HTML",
				fieldname: "help_text",
				options: `
					<div style="background: #e3f2fd; padding: 10px; border-radius: 5px; margin: 10px 0;">
						<h4 style="margin: 0 0 8px 0;">📋 Which number should I use?</h4>
						<p style="margin: 5px 0;"><strong>✅ Use Flight Numbers:</strong> D3189, D3186 (from "Flight #" column)</p>
						<p style="margin: 5px 0;"><strong>❌ Don't use:</strong></p>
						<ul style="margin: 5px 0; padding-left: 20px;">
							<li>Booking Reference (e.g., J6HRDK)</li>
							<li>Ticket Number (e.g., 9915000320139)</li>
						</ul>
						<p style="margin: 5px 0;"><strong>💡 Tip:</strong> For round trips, lookup each flight number separately or enter them separated by commas above.</p>
					</div>
				`,
			},
		],
		primary_action_label: __("Lookup Flight(s)"),
		primary_action: function (values) {
			lookup_flight_info(frm, values);
			d.hide();
		},
		secondary_action_label: __("Cancel"),
		secondary_action: function () {
			d.hide();
		},
	});

	d.show();
}

function lookup_flight_info(frm, values) {
	// Check if multiple flights are provided
	let flight_numbers = [];
	
	if (values.multiple_flights && values.multiple_flights.trim()) {
		// Parse comma-separated flight numbers
		flight_numbers = values.multiple_flights
			.split(",")
			.map(f => f.trim())
			.filter(f => f.length > 0);
	}
	
	// Add the main flight number if provided
	if (values.flight_number && values.flight_number.trim()) {
		flight_numbers.push(values.flight_number.trim());
	}
	
	if (flight_numbers.length === 0) {
		frappe.msgprint({
			title: __("No Flight Number"),
			message: __("Please enter at least one flight number."),
			indicator: "orange",
		});
		return;
	}
	
	// Remove duplicates
	flight_numbers = [...new Set(flight_numbers)];
	
	if (flight_numbers.length > 1) {
		// Lookup multiple flights
		lookup_multiple_flights(frm, flight_numbers, values.flight_date);
	} else {
		// Lookup single flight
		lookup_single_flight(frm, flight_numbers[0], values.flight_date);
	}
}

function lookup_single_flight(frm, flight_number, flight_date) {
	frappe.show_alert(__("Looking up flight information..."), 3);

	frappe.call({
		method: "nextlayer.next_layer.api.aviation_stack_utils.get_flight_details",
		args: {
			flight_number: flight_number,
			flight_date: flight_date,
		},
		callback: function (r) {
			if (r.message) {
				const result = r.message;

				if (result.success) {
					display_flight_info(result.data, flight_number);
				} else {
					frappe.show_alert(
						__("Failed to fetch flight details: ") + (result.error || "Unknown error"),
						5,
						"red"
					);

					let error_message = `
                        <div style="padding: 10px;">
                            <p><strong>Flight Number:</strong> ${flight_number}</p>
                            <p><strong>Error:</strong> ${result.error || "Unknown error"}</p>
                            ${result.error_details ? `<p><strong>Details:</strong> ${result.error_details}</p>` : ""}
                    `;
					
					// Show debug information if available
					if (result.debug_info) {
						error_message += `
							<details style="margin-top: 10px;">
								<summary style="cursor: pointer; color: #1976d2; font-weight: bold;">🔍 Debug Information</summary>
								<div style="margin-top: 10px; padding: 10px; background: #f5f5f5; border-radius: 5px;">
									<pre style="white-space: pre-wrap; font-size: 11px;">${result.debug_info}</pre>
								</div>
							</details>
						`;
					}
					
					if (result.tried_params) {
						error_message += `
							<p style="margin-top: 10px;"><strong>Parameters Tried:</strong></p>
							<ul>
								${result.tried_params.map(p => `<li>${p.join(", ")}</li>`).join("")}
							</ul>
						`;
					}
					
					error_message += `
						<div style="margin-top: 15px; padding: 10px; background: #fff3cd; border-radius: 5px;">
							<p><strong>💡 Troubleshooting Tips:</strong></p>
							<ul>
								<li>Try entering the flight date (e.g., 2025-12-18 for D3189)</li>
								<li>Verify the flight number is correct (e.g., D3189, not D3-189)</li>
								<li>Check if the flight exists in Aviation Stack database</li>
								<li>Some airlines may not be fully covered in the API</li>
							</ul>
						</div>
					</div>
					`;

					frappe.msgprint({
						title: __("Flight Lookup Failed"),
						message: error_message,
						indicator: "red",
					});
				}
			}
		},
	});
}

function lookup_multiple_flights(frm, flight_numbers, flight_date) {
	frappe.show_alert(__(`Looking up ${flight_numbers.length} flight(s)...`), 3);
	
	let all_results = [];
	let completed = 0;
	let has_errors = false;
	
	flight_numbers.forEach((flight_number, index) => {
		frappe.call({
			method: "nextlayer.next_layer.api.aviation_stack_utils.get_flight_details",
			args: {
				flight_number: flight_number,
				flight_date: flight_date,
			},
			callback: function (r) {
				completed++;
				
				if (r.message && r.message.success) {
					all_results.push({
						flight_number: flight_number,
						data: r.message.data,
					});
				} else {
					has_errors = true;
					all_results.push({
						flight_number: flight_number,
						error: r.message?.error || "Unknown error",
					});
				}
				
				// When all requests are complete, display results
				if (completed === flight_numbers.length) {
					display_multiple_flights_info(all_results, has_errors);
				}
			},
		});
	});
}

function display_flight_info(flight_data, flight_number_searched = null) {
	if (!flight_data || flight_data.length === 0) {
		frappe.msgprint({
			title: __("No Flight Found"),
			message: __(
				`<div style="padding: 10px;">
					<p>No flight information found for: <strong>${flight_number_searched || "the provided number"}</strong></p>
					<p><strong>Tip:</strong> Make sure you're using the flight number (e.g., D3189), not the booking reference or ticket number.</p>
				</div>`
			),
			indicator: "orange",
		});
		return;
	}

	// Display the first flight result (most relevant)
	const flight = flight_data[0];
	const flight_info = flight.flight || {};
	const departure = flight.departure || {};
	const arrival = flight.arrival || {};
	const airline = flight.airline || {};
	const aircraft = flight.aircraft || {};

	let message = `
		<div style="padding: 15px; max-width: 900px;">
			<h3 style="margin-top: 0;">✈️ Flight Information</h3>
			${flight_number_searched ? `<p style="color: #666; margin-bottom: 15px;">Searched for: <strong>${flight_number_searched}</strong></p>` : ""}
			
			<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-bottom: 15px;">
				<div style="background: #f5f5f5; padding: 10px; border-radius: 5px;">
					<h4 style="margin: 0 0 10px 0; color: #333;">Flight Details</h4>
					<p><strong>Flight Number:</strong> ${flight_info.iata || flight_info.icao || "N/A"}</p>
					<p><strong>Airline:</strong> ${airline.name || "N/A"}</p>
					<p><strong>Aircraft:</strong> ${aircraft?.registration || aircraft?.iata || "N/A"}</p>
					<p><strong>Status:</strong> <span style="color: ${get_status_color(flight.flight_status)}; font-weight: bold;">${flight.flight_status || "N/A"}</span></p>
				</div>
				
				<div style="background: #f5f5f5; padding: 10px; border-radius: 5px;">
					<h4 style="margin: 0 0 10px 0; color: #333;">Route</h4>
					<p><strong>From:</strong> ${departure.airport || "N/A"} (${departure.iata || "N/A"})</p>
					<p><strong>To:</strong> ${arrival.airport || "N/A"} (${arrival.iata || "N/A"})</p>
				</div>
			</div>
			
			<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px;">
				<div style="background: #e3f2fd; padding: 10px; border-radius: 5px;">
					<h4 style="margin: 0 0 10px 0; color: #1976d2;">🛫 Departure</h4>
					<p><strong>Airport:</strong> ${departure.airport || "N/A"}</p>
					<p><strong>Terminal:</strong> ${departure.terminal || "N/A"}</p>
					<p><strong>Gate:</strong> ${departure.gate || "N/A"}</p>
					<p><strong>Scheduled:</strong> ${format_datetime(departure.scheduled) || "N/A"}</p>
					<p><strong>Estimated:</strong> ${format_datetime(departure.estimated) || "N/A"}</p>
					<p><strong>Actual:</strong> ${format_datetime(departure.actual) || "N/A"}</p>
					<p><strong>Delay:</strong> ${departure.delay ? '<span style="color: #ff9800;">' + departure.delay + " minutes</span>" : '<span style="color: #4caf50;">On time</span>'}</p>
				</div>
				
				<div style="background: #e8f5e9; padding: 10px; border-radius: 5px;">
					<h4 style="margin: 0 0 10px 0; color: #388e3c;">🛬 Arrival</h4>
					<p><strong>Airport:</strong> ${arrival.airport || "N/A"}</p>
					<p><strong>Terminal:</strong> ${arrival.terminal || "N/A"}</p>
					<p><strong>Gate:</strong> ${arrival.gate || "N/A"}</p>
					<p><strong>Scheduled:</strong> ${format_datetime(arrival.scheduled) || "N/A"}</p>
					<p><strong>Estimated:</strong> ${format_datetime(arrival.estimated) || "N/A"}</p>
					<p><strong>Actual:</strong> ${format_datetime(arrival.actual) || "N/A"}</p>
					<p><strong>Delay:</strong> ${arrival.delay ? '<span style="color: #ff9800;">' + arrival.delay + " minutes</span>" : '<span style="color: #4caf50;">On time</span>'}</p>
				</div>
			</div>
		</div>
	`;

	frappe.msgprint({
		title: __("Flight Information"),
		message: message,
		indicator: "green",
	});
}

function display_multiple_flights_info(all_results, has_errors) {
	let message = `<div style="padding: 15px; max-width: 1000px;"><h3 style="margin-top: 0;">✈️ Flight Information (${all_results.length} flight(s))</h3>`;
	
	all_results.forEach((result, index) => {
		if (result.error) {
			message += `
				<div style="background: #ffebee; padding: 15px; border-radius: 5px; margin-bottom: 15px; border-left: 4px solid #f44336;">
					<h4 style="margin: 0 0 10px 0; color: #c62828;">❌ Flight ${result.flight_number}</h4>
					<p><strong>Error:</strong> ${result.error}</p>
				</div>
			`;
		} else if (result.data && result.data.length > 0) {
			const flight = result.data[0];
			const flight_info = flight.flight || {};
			const departure = flight.departure || {};
			const arrival = flight.arrival || {};
			const airline = flight.airline || {};
			
			message += `
				<div style="background: #f5f5f5; padding: 15px; border-radius: 5px; margin-bottom: 15px; border-left: 4px solid #4caf50;">
					<h4 style="margin: 0 0 15px 0; color: #333;">✈️ Flight ${result.flight_number}</h4>
					<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px;">
						<div>
							<p><strong>Flight:</strong> ${flight_info.iata || flight_info.icao || "N/A"}</p>
							<p><strong>Airline:</strong> ${airline.name || "N/A"}</p>
							<p><strong>Status:</strong> <span style="color: ${get_status_color(flight.flight_status)}; font-weight: bold;">${flight.flight_status || "N/A"}</span></p>
						</div>
						<div>
							<p><strong>Route:</strong> ${departure.iata || "N/A"} → ${arrival.iata || "N/A"}</p>
							<p><strong>Departure:</strong> ${format_datetime(departure.scheduled) || "N/A"}</p>
							<p><strong>Arrival:</strong> ${format_datetime(arrival.scheduled) || "N/A"}</p>
						</div>
					</div>
					<div style="margin-top: 10px; padding-top: 10px; border-top: 1px solid #ddd;">
						<details>
							<summary style="cursor: pointer; color: #1976d2;">View Full Details</summary>
							<div style="margin-top: 10px; display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
								<div>
									<p><strong>🛫 Departure Terminal:</strong> ${departure.terminal || "N/A"}</p>
									<p><strong>Gate:</strong> ${departure.gate || "N/A"}</p>
									<p><strong>Delay:</strong> ${departure.delay ? departure.delay + " min" : "On time"}</p>
								</div>
								<div>
									<p><strong>🛬 Arrival Terminal:</strong> ${arrival.terminal || "N/A"}</p>
									<p><strong>Gate:</strong> ${arrival.gate || "N/A"}</p>
									<p><strong>Delay:</strong> ${arrival.delay ? arrival.delay + " min" : "On time"}</p>
								</div>
							</div>
						</details>
					</div>
				</div>
			`;
		} else {
			message += `
				<div style="background: #fff3e0; padding: 15px; border-radius: 5px; margin-bottom: 15px; border-left: 4px solid #ff9800;">
					<h4 style="margin: 0 0 10px 0; color: #e65100;">⚠️ Flight ${result.flight_number}</h4>
					<p>No flight information found.</p>
				</div>
			`;
		}
	});
	
	message += `</div>`;
	
	frappe.msgprint({
		title: __("Flight Information"),
		message: message,
		indicator: has_errors ? "orange" : "green",
	});
}

function format_datetime(datetime_string) {
	if (!datetime_string) return null;
	try {
		const date = new Date(datetime_string);
		return date.toLocaleString();
	} catch (e) {
		return datetime_string;
	}
}

function get_status_color(status) {
	if (!status) return "#666";
	const status_lower = status.toLowerCase();
	if (status_lower.includes("scheduled") || status_lower.includes("on time")) {
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

function test_aviation_stack_connection(frm) {
	frappe.show_alert(__("Testing Aviation Stack connection..."), 3);

	frappe.call({
		method: "nextlayer.next_layer.api.aviation_stack_utils.test_connection",
		callback: function (r) {
			if (r.message && r.message.success) {
				frappe.show_alert(__("Connection test successful!"), 5, "green");

				frappe.msgprint({
					title: __("Connection Test Successful"),
					message: __(`
                        <div style="padding: 10px;">
                            <p><strong>Status:</strong> ✅ Connected</p>
                            <p><strong>API Endpoint:</strong> ${r.message.endpoint || "N/A"}</p>
                            <p><strong>Message:</strong> ${r.message.message || "Connection successful"}</p>
                        </div>
                    `),
					indicator: "green",
				});
			} else {
				frappe.show_alert(
					__("Connection test failed: ") + (r.message?.error || "Unknown error"),
					5,
					"red"
				);

				frappe.msgprint({
					title: __("Connection Test Failed"),
					message: __(`
                        <div style="padding: 10px;">
                            <p><strong>Error:</strong> ${r.message?.error || "Unknown error"}</p>
                            ${r.message?.error_details ? `<p><strong>Details:</strong> ${r.message.error_details}</p>` : ""}
                        </div>
                    `),
					indicator: "red",
				});
			}
		},
	});
}

