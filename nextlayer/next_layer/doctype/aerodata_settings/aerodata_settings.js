// Copyright (c) 2025, Next Layer and contributors
// For license information, please see license.txt

frappe.ui.form.on("Aerodata Settings", {
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
				test_aerodata_connection(frm);
			},
			__("Actions")
		).addClass("btn-info");

		// Add button to check historical data (Flight History & Schedule range of dates)
		frm.add_custom_button(
			__("Check Historical Data"),
			function () {
				historical_data_modal(frm);
			},
			__("Actions")
		).addClass("btn-default");
	},
});

function historical_data_modal(frm) {
	let d = new frappe.ui.Dialog({
		title: __("Check Historical Data"),
		fields: [
			{
				fieldtype: "Section Break",
				label: __("Flight & Date Range"),
			},
			{
				fieldtype: "Data",
				fieldname: "flight_number",
				label: __("Flight Number"),
				description: __(
					"e.g. D3189, AA100. Historical and schedule data for this flight in the selected date range."
				),
				reqd: 1,
			},
			{
				fieldtype: "Date",
				fieldname: "date_from",
				label: __("Date From"),
				description: __("Start date (YYYY-MM-DD). Optional for some plans."),
			},
			{
				fieldtype: "Date",
				fieldname: "date_to",
				label: __("Date To"),
				description: __("End date (YYYY-MM-DD). Optional for some plans."),
			},
			{
				fieldtype: "Column Break",
			},
			{
				fieldtype: "HTML",
				fieldname: "historical_help",
				options: `
					<div style="padding: 10px; background: #e3f2fd; border-radius: 5px; font-size: 12px;">
						<p><strong>Flight History & Schedule (range of dates)</strong></p>
						<p>AeroDataBox returns current, future and historical flights for the flight number in the given range.</p>
						<p><a href="https://api.market/store/aedbx/aerodatabox" target="_blank" rel="noopener">API.Market – AeroDataBox</a></p>
					</div>
				`,
			},
		],
		primary_action_label: __("Fetch Historical Data"),
		primary_action: function (values) {
			lookup_historical_data(frm, values);
			d.hide();
		},
		secondary_action_label: __("Cancel"),
		secondary_action: function () {
			d.hide();
		},
	});
	d.show();
}

function lookup_historical_data(frm, values) {
	let flight_number = (values.flight_number || "").trim();
	if (!flight_number) {
		frappe.msgprint({ title: __("Required"), message: __("Please enter a flight number."), indicator: "orange" });
		return;
	}
	frappe.show_alert(__("Fetching historical data..."), 3);
	frappe.call({
		method: "nextlayer.next_layer.api.aerodata_utils.get_flight_history",
		args: {
			flight_number: flight_number,
			date_from: values.date_from || null,
			date_to: values.date_to || null,
		},
		callback: function (r) {
			if (!r.message) return;
			let res = r.message;
			if (res.success) {
				display_historical_results(res);
			} else {
				frappe.msgprint({
					title: __("Historical Data Failed"),
					message: __(
						"<div style='padding: 10px;'><p><strong>Error:</strong> " +
						(res.error || "Unknown error") +
						"</p>" +
						(res.error_details ? "<p><strong>Details:</strong> " + res.error_details + "</p>" : "") +
						"</div>"
					),
					indicator: "red",
				});
			}
		},
	});
}

function display_historical_results(res) {
	let flights = res.data || [];
	let count = res.count != null ? res.count : flights.length;
	let flight_number_label = res.flight_number || "";
	let date_from = res.date_from || "";
	let date_to = res.date_to || "";

	if (flights.length === 0) {
		frappe.msgprint({
			title: __("Historical Data"),
			message: __(
				"<div style='padding: 15px;'><p>No flights found for <strong>" +
				flight_number_label +
				"</strong>" +
				(date_from || date_to ? " in the selected date range." : ".") +
				"</p><p>Try a different flight number or date range.</p></div>"
			),
			indicator: "orange",
		});
		return;
	}

	let message = `
		<div style="padding: 15px; max-width: 960px;">
			<h3 style="margin-top: 0;">Historical / schedule data: ${flight_number_label}</h3>
			<p style="color: #666; margin-bottom: 20px;">${count} flight(s) found${date_from || date_to ? " (" + (date_from || "?") + " to " + (date_to || "?") + ")" : ""}</p>
	`;
	flights.forEach(function (flight, index) {
		let departure = flight.departure || {};
		let arrival = flight.arrival || {};
		let dep_airport = departure.airport || {};
		let arr_airport = arrival.airport || {};
		let dep_scheduled = departure.scheduledTime || {};
		let arr_scheduled = arrival.scheduledTime || {};
		let arr_predicted = arrival.predictedTime || {};
		let airline = flight.airline || {};
		let aircraft = flight.aircraft || {};
		let status = flight.status || "N/A";
		let distance = flight.greatCircleDistance || {};
		let flight_num = flight.number || flight.flightNumber || flight_number_label;
		message += `
			<div style="background: #fafafa; padding: 15px; border-radius: 8px; margin-bottom: 20px; border-left: 4px solid #2196f3; box-shadow: 0 1px 3px rgba(0,0,0,0.08);">
				<h4 style="margin: 0 0 15px 0; color: #333;">✈️ Flight ${flight_num}${flights.length > 1 ? " — #" + (index + 1) : ""}</h4>
				<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-bottom: 15px;">
					<div style="background: #f5f5f5; padding: 12px; border-radius: 5px;">
						<h5 style="margin: 0 0 8px 0; color: #333;">Flight Details</h5>
						<p style="margin: 4px 0;"><strong>Flight Number:</strong> ${flight_num}</p>
						<p style="margin: 4px 0;"><strong>Airline:</strong> ${airline.name || "N/A"} (${airline.iata || ""}${airline.icao ? " / " + airline.icao : ""})</p>
						<p style="margin: 4px 0;"><strong>Aircraft:</strong> ${aircraft.model || "N/A"}</p>
						<p style="margin: 4px 0;"><strong>Status:</strong> <span style="color: ${get_status_color(status)}; font-weight: bold;">${status}</span></p>
						${distance.km ? `<p style="margin: 4px 0;"><strong>Distance:</strong> ${distance.km} km (${distance.mile || ""} miles)</p>` : ""}
					</div>
					<div style="background: #f5f5f5; padding: 12px; border-radius: 5px;">
						<h5 style="margin: 0 0 8px 0; color: #333;">Route</h5>
						<p style="margin: 4px 0;"><strong>From:</strong> ${dep_airport.name || dep_airport.shortName || "N/A"} (${dep_airport.iata || "N/A"})</p>
						<p style="margin: 4px 0;"><strong>To:</strong> ${arr_airport.name || arr_airport.shortName || "N/A"} (${arr_airport.iata || "N/A"})</p>
						${dep_airport.municipalityName ? `<p style="margin: 4px 0;"><strong>Departure City:</strong> ${dep_airport.municipalityName}</p>` : ""}
						${arr_airport.municipalityName ? `<p style="margin: 4px 0;"><strong>Arrival City:</strong> ${arr_airport.municipalityName}</p>` : ""}
					</div>
				</div>
				<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px;">
					<div style="background: #e3f2fd; padding: 12px; border-radius: 5px;">
						<h5 style="margin: 0 0 8px 0; color: #1976d2;">🛫 Departure</h5>
						<p style="margin: 4px 0;"><strong>Airport:</strong> ${dep_airport.name || dep_airport.shortName || "N/A"}</p>
						<p style="margin: 4px 0;"><strong>Code:</strong> ${dep_airport.iata || "N/A"} / ${dep_airport.icao || "N/A"}</p>
						<p style="margin: 4px 0;"><strong>Terminal:</strong> ${departure.terminal || "N/A"}</p>
						<p style="margin: 4px 0;"><strong>Scheduled (Local):</strong> ${dep_scheduled.local || "N/A"}</p>
						<p style="margin: 4px 0;"><strong>Scheduled (UTC):</strong> ${dep_scheduled.utc || "N/A"}</p>
						${dep_airport.timeZone ? `<p style="margin: 4px 0;"><strong>Time Zone:</strong> ${dep_airport.timeZone}</p>` : ""}
					</div>
					<div style="background: #e8f5e9; padding: 12px; border-radius: 5px;">
						<h5 style="margin: 0 0 8px 0; color: #388e3c;">🛬 Arrival</h5>
						<p style="margin: 4px 0;"><strong>Airport:</strong> ${arr_airport.name || arr_airport.shortName || "N/A"}</p>
						<p style="margin: 4px 0;"><strong>Code:</strong> ${arr_airport.iata || "N/A"} / ${arr_airport.icao || "N/A"}</p>
						<p style="margin: 4px 0;"><strong>Terminal:</strong> ${arrival.terminal || "N/A"}</p>
						<p style="margin: 4px 0;"><strong>Scheduled (Local):</strong> ${arr_scheduled.local || "N/A"}</p>
						<p style="margin: 4px 0;"><strong>Scheduled (UTC):</strong> ${arr_scheduled.utc || "N/A"}</p>
						${arr_predicted.local ? `<p style="margin: 4px 0;"><strong>Predicted (Local):</strong> <span style="color: #ff9800;">${arr_predicted.local}</span></p>` : ""}
						${arr_predicted.utc ? `<p style="margin: 4px 0;"><strong>Predicted (UTC):</strong> <span style="color: #ff9800;">${arr_predicted.utc}</span></p>` : ""}
						${arr_airport.timeZone ? `<p style="margin: 4px 0;"><strong>Time Zone:</strong> ${arr_airport.timeZone}</p>` : ""}
					</div>
				</div>
				${flight.lastUpdatedUtc ? `
					<div style="margin-top: 12px; padding: 8px; background: #f5f5f5; border-radius: 5px;">
						<p style="margin: 0; color: #666; font-size: 12px;"><strong>Last Updated:</strong> ${format_datetime(flight.lastUpdatedUtc)}</p>
					</div>
				` : ""}
			</div>
		`;
	});
	message += "</div>";

	frappe.msgprint({
		title: __("Historical Data"),
		message: message,
		indicator: "green",
	});
}

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
					"<strong>Enter the Flight Number (e.g., D3189, D3186)</strong><br>" +
					"<span style='color: #666;'>Use the flight number from your booking confirmation</span>"
				),
				reqd: 1,
			},
			{
				fieldtype: "Date",
				fieldname: "flight_date",
				label: __("Flight Date"),
				description: __(
					"<strong>Recommended:</strong> Enter the flight date (e.g., 2025-12-18) to get accurate results."
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
		method: "nextlayer.next_layer.api.aerodata_utils.get_flight_details",
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
					
					error_message += `
						<div style="margin-top: 15px; padding: 10px; background: #fff3cd; border-radius: 5px;">
							<p><strong>💡 Troubleshooting Tips:</strong></p>
							<ul>
								<li>Try entering the flight date (e.g., 2025-12-18 for D3189)</li>
								<li>Verify the flight number is correct (e.g., D3189, not D3-189)</li>
								<li>Check if the flight exists in Aerodata database</li>
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
			method: "nextlayer.next_layer.api.aerodata_utils.get_flight_details",
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
	if (!flight_data || (Array.isArray(flight_data) && flight_data.length === 0)) {
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

	// Handle both single flight object and array of flights
	let flights = Array.isArray(flight_data) ? flight_data : [flight_data];
	
	// If multiple flights, show them all (e.g., multi-leg flights)
	if (flights.length > 1) {
		display_multiple_flights_info(
			flights.map(f => ({ flight_number: flight_number_searched, data: f })),
			false
		);
		return;
	}
	
	const flight = flights[0];
	
	// Extract flight information based on Aerodata API structure
	const flight_number = flight.number || flight.flightNumber || flight_number_searched || "N/A";
	const airline = flight.airline || {};
	const departure = flight.departure || {};
	const arrival = flight.arrival || {};
	const aircraft = flight.aircraft || {};
	const status = flight.status || "N/A";
	const distance = flight.greatCircleDistance || {};
	
	// Extract airport information
	const dep_airport = departure.airport || {};
	const arr_airport = arrival.airport || {};
	
	// Extract scheduled times
	const dep_scheduled = departure.scheduledTime || {};
	const arr_scheduled = arrival.scheduledTime || {};
	const arr_predicted = arrival.predictedTime || {};

	let message = `
		<div style="padding: 15px; max-width: 900px;">
			<h3 style="margin-top: 0;">✈️ Flight Information</h3>
			${flight_number_searched ? `<p style="color: #666; margin-bottom: 15px;">Searched for: <strong>${flight_number_searched}</strong></p>` : ""}
			
			<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-bottom: 15px;">
				<div style="background: #f5f5f5; padding: 10px; border-radius: 5px;">
					<h4 style="margin: 0 0 10px 0; color: #333;">Flight Details</h4>
					<p><strong>Flight Number:</strong> ${flight_number}</p>
					<p><strong>Airline:</strong> ${airline.name || "N/A"} (${airline.iata || ""}${airline.icao ? "/" + airline.icao : ""})</p>
					<p><strong>Aircraft:</strong> ${aircraft.model || "N/A"}</p>
					<p><strong>Status:</strong> <span style="color: ${get_status_color(status)}; font-weight: bold;">${status}</span></p>
					${distance.km ? `<p><strong>Distance:</strong> ${distance.km} km (${distance.mile} miles)</p>` : ""}
				</div>
				
				<div style="background: #f5f5f5; padding: 10px; border-radius: 5px;">
					<h4 style="margin: 0 0 10px 0; color: #333;">Route</h4>
					<p><strong>From:</strong> ${dep_airport.name || dep_airport.shortName || "N/A"} (${dep_airport.iata || "N/A"})</p>
					<p><strong>To:</strong> ${arr_airport.name || arr_airport.shortName || "N/A"} (${arr_airport.iata || "N/A"})</p>
					${dep_airport.municipalityName ? `<p><strong>Departure City:</strong> ${dep_airport.municipalityName}</p>` : ""}
					${arr_airport.municipalityName ? `<p><strong>Arrival City:</strong> ${arr_airport.municipalityName}</p>` : ""}
				</div>
			</div>
			
			<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px;">
				<div style="background: #e3f2fd; padding: 10px; border-radius: 5px;">
					<h4 style="margin: 0 0 10px 0; color: #1976d2;">🛫 Departure</h4>
					<p><strong>Airport:</strong> ${dep_airport.name || dep_airport.shortName || "N/A"}</p>
					<p><strong>Code:</strong> ${dep_airport.iata || "N/A"} / ${dep_airport.icao || "N/A"}</p>
					<p><strong>Terminal:</strong> ${departure.terminal || "N/A"}</p>
					<p><strong>Scheduled (Local):</strong> ${dep_scheduled.local || "N/A"}</p>
					<p><strong>Scheduled (UTC):</strong> ${dep_scheduled.utc || "N/A"}</p>
					${dep_airport.timeZone ? `<p><strong>Time Zone:</strong> ${dep_airport.timeZone}</p>` : ""}
				</div>
				
				<div style="background: #e8f5e9; padding: 10px; border-radius: 5px;">
					<h4 style="margin: 0 0 10px 0; color: #388e3c;">🛬 Arrival</h4>
					<p><strong>Airport:</strong> ${arr_airport.name || arr_airport.shortName || "N/A"}</p>
					<p><strong>Code:</strong> ${arr_airport.iata || "N/A"} / ${arr_airport.icao || "N/A"}</p>
					<p><strong>Terminal:</strong> ${arrival.terminal || "N/A"}</p>
					<p><strong>Scheduled (Local):</strong> ${arr_scheduled.local || "N/A"}</p>
					<p><strong>Scheduled (UTC):</strong> ${arr_scheduled.utc || "N/A"}</p>
					${arr_predicted.local ? `<p><strong>Predicted (Local):</strong> <span style="color: #ff9800;">${arr_predicted.local}</span></p>` : ""}
					${arr_predicted.utc ? `<p><strong>Predicted (UTC):</strong> <span style="color: #ff9800;">${arr_predicted.utc}</span></p>` : ""}
					${arr_airport.timeZone ? `<p><strong>Time Zone:</strong> ${arr_airport.timeZone}</p>` : ""}
				</div>
			</div>
			
			${flight.lastUpdatedUtc ? `
				<div style="margin-top: 15px; padding: 10px; background: #f5f5f5; border-radius: 5px;">
					<p style="margin: 0; color: #666; font-size: 12px;"><strong>Last Updated:</strong> ${format_datetime(flight.lastUpdatedUtc)}</p>
				</div>
			` : ""}
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
		} else if (result.data) {
			let flights = Array.isArray(result.data) ? result.data : [result.data];
			if (flights.length > 0) {
				flights.forEach((flight, flightIndex) => {
					const departure = flight.departure || {};
					const arrival = flight.arrival || {};
					const airline = flight.airline || {};
					const dep_airport = departure.airport || {};
					const arr_airport = arrival.airport || {};
					const dep_scheduled = departure.scheduledTime || {};
					const arr_scheduled = arrival.scheduledTime || {};
					const arr_predicted = arrival.predictedTime || {};
					
					message += `
						<div style="background: #f5f5f5; padding: 15px; border-radius: 5px; margin-bottom: 15px; border-left: 4px solid #4caf50;">
							<h4 style="margin: 0 0 15px 0; color: #333;">✈️ Flight ${flight.number || result.flight_number}${flights.length > 1 ? ` - Leg ${flightIndex + 1}` : ""}</h4>
							<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-bottom: 10px;">
								<div>
									<p><strong>Flight:</strong> ${flight.number || result.flight_number}</p>
									<p><strong>Airline:</strong> ${airline.name || "N/A"} (${airline.iata || ""}${airline.icao ? "/" + airline.icao : ""})</p>
									<p><strong>Aircraft:</strong> ${flight.aircraft?.model || "N/A"}</p>
									<p><strong>Status:</strong> <span style="color: ${get_status_color(flight.status)}; font-weight: bold;">${flight.status || "N/A"}</span></p>
								</div>
								<div>
									<p><strong>Route:</strong> ${dep_airport.iata || "N/A"} → ${arr_airport.iata || "N/A"}</p>
									<p><strong>From:</strong> ${dep_airport.name || dep_airport.shortName || "N/A"}</p>
									<p><strong>To:</strong> ${arr_airport.name || arr_airport.shortName || "N/A"}</p>
								</div>
							</div>
							<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; padding-top: 10px; border-top: 1px solid #ddd;">
								<div>
									<p><strong>🛫 Departure</strong></p>
									<p style="margin: 5px 0;"><strong>Local:</strong> ${dep_scheduled.local || "N/A"}</p>
									<p style="margin: 5px 0;"><strong>UTC:</strong> ${dep_scheduled.utc || "N/A"}</p>
									${departure.terminal ? `<p style="margin: 5px 0;"><strong>Terminal:</strong> ${departure.terminal}</p>` : ""}
								</div>
								<div>
									<p><strong>🛬 Arrival</strong></p>
									<p style="margin: 5px 0;"><strong>Local:</strong> ${arr_scheduled.local || "N/A"}</p>
									<p style="margin: 5px 0;"><strong>UTC:</strong> ${arr_scheduled.utc || "N/A"}</p>
									${arr_predicted.local ? `<p style="margin: 5px 0;"><strong>Predicted:</strong> <span style="color: #ff9800;">${arr_predicted.local}</span></p>` : ""}
									${arrival.terminal ? `<p style="margin: 5px 0;"><strong>Terminal:</strong> ${arrival.terminal}</p>` : ""}
								</div>
							</div>
						</div>
					`;
				});
			}
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

function test_aerodata_connection(frm) {
	frappe.show_alert(__("Testing Aerodata connection..."), 3);

	frappe.call({
		method: "nextlayer.next_layer.api.aerodata_utils.test_connection",
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

