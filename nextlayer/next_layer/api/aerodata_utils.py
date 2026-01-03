# Copyright (c) 2025, Next Layer and contributors
# For license information, please see license.txt

import frappe
import requests
from frappe import _


@frappe.whitelist()
def get_flight_details(flight_number, flight_date=None):
	"""
	Get flight details from Aerodata API
	
	Args:
		flight_number: Flight number (e.g., D3189, D3186)
		flight_date: Optional date in YYYY-MM-DD format to search for specific date
	
	Returns:
		dict: Flight information or error details
	"""
	try:
		# Get settings
		settings = frappe.get_single("Aerodata Settings")
		
		if not settings.enabled:
			return {
				"success": False,
				"error": "Aerodata integration is not enabled",
			}
		
		if not settings.api_key:
			return {
				"success": False,
				"error": "API Key is not configured",
			}
		
		api_key = settings.get_password("api_key")
		api_endpoint = settings.api_endpoint or "https://prod.api.market/api/v1/aedbx/aerodatabox"
		
		flight_number_upper = flight_number.upper().strip()
		
		# Construct API URL
		# Format: /flights/Number/{flight_number}?dateLocalRole=Both&withAircraftImage=false&withLocation=false
		url = f"{api_endpoint}/flights/Number/{flight_number_upper}"
		
		# Build query parameters
		params = {
			"dateLocalRole": "Both",
			"withAircraftImage": "false",
			"withLocation": "false"
		}
		
		# Add date if provided (format: YYYY-MM-DD)
		if flight_date:
			params["date"] = flight_date
		
		# Set headers
		headers = {
			"accept": "application/json",
			"x-api-market-key": api_key
		}
		
		# Make API request
		response = requests.get(url, params=params, headers=headers, timeout=30)
		
		# Log the response for debugging
		frappe.logger().info(f"Aerodata API Request: {url} with params {params}")
		frappe.logger().info(f"Aerodata API Response Status: {response.status_code}")
		
		if response.status_code == 200:
			data = response.json()
			
			# Log the response for debugging
			frappe.logger().info(f"Aerodata API Response: {str(data)[:500]}")
			
			# Check if we have flight data
			# Aerodata API returns an array of flight objects
			flights = None
			
			if isinstance(data, list):
				flights = data
			elif isinstance(data, dict):
				# Check various possible keys
				flights = data.get("data") or data.get("flights") or data.get("results")
				if not flights and "number" in data:
					# Single flight object
					flights = [data]
			
			if not flights or len(flights) == 0:
				return {
					"success": False,
					"error": f"No flight found for {flight_number}",
					"debug_info": f"API Response: {str(data)[:300]}"
				}
			
			# Filter flights that match our flight number (in case API returns multiple)
			# The API returns flights with "number" field like "D3 189" (with space)
			# We need to match against flight_number_upper which might be "D3189"
			matching_flights = []
			for flight in flights:
				flight_num = str(flight.get("number") or flight.get("flightNumber") or "").upper().replace(" ", "")
				flight_num_original = str(flight.get("number") or flight.get("flightNumber") or "").upper()
				
				# Match with or without spaces
				if (flight_num == flight_number_upper.replace(" ", "") or 
					flight_number_upper.replace(" ", "") in flight_num or
					flight_num_original.replace(" ", "") == flight_number_upper.replace(" ", "")):
					
					# If flight_date is provided, filter by date
					if flight_date:
						# Extract departure date from flight data
						# Check various possible date fields in the flight object
						departure_date = None
						
						# Try to get departure date from different possible locations
						departure = flight.get("departure") or flight.get("departureDate") or flight.get("departure_date")
						departure_datetime = None
						
						if isinstance(departure, dict):
							# Check for scheduledTime.local first (most common in Aerodata API)
							scheduled_time = departure.get("scheduledTime")
							if isinstance(scheduled_time, dict):
								departure_datetime = scheduled_time.get("local") or scheduled_time.get("utc")
							
							# If not found, check other possible fields
							if not departure_datetime:
								departure_datetime = (
									departure.get("dateTime") or 
									departure.get("scheduledDateTime") or 
									departure.get("date") or
									departure.get("local") or
									departure.get("scheduled")
								)
							if departure_datetime:
								# Extract date part (YYYY-MM-DD) from datetime string
								if isinstance(departure_datetime, str):
									# Simple extraction: get first 10 characters if format is YYYY-MM-DD
									# Handle formats like "2026-01-03 20:10+05:30" or "2026-01-03T20:10:00"
									dt_str = departure_datetime.strip()
									# Remove timezone and time parts
									if '+' in dt_str:
										dt_str = dt_str.split('+')[0]
									if 'Z' in dt_str:
										dt_str = dt_str.split('Z')[0]
									if 'T' in dt_str:
										dt_str = dt_str.split('T')[0]
									if ' ' in dt_str:
										dt_str = dt_str.split(' ')[0]
									# Extract date part (should be YYYY-MM-DD format)
									if len(dt_str) >= 10 and dt_str[4] == '-' and dt_str[7] == '-':
										departure_date = dt_str[:10]
						elif isinstance(departure, str):
							# If departure is a string, try to extract date
							if len(departure) >= 10:
								departure_date = departure[:10]
						
						# If we still don't have a date, check top-level date fields
						if not departure_date:
							flight_date_field = flight.get("date") or flight.get("flightDate") or flight.get("flight_date")
							if flight_date_field:
								if isinstance(flight_date_field, str) and len(flight_date_field) >= 10:
									departure_date = flight_date_field[:10]
						
						# Compare dates (both should be in YYYY-MM-DD format)
						if departure_date:
							if departure_date != flight_date:
								# Date doesn't match, skip this flight
								continue
						else:
							# Couldn't extract date, but user requested specific date
							# Skip this flight to ensure we only return flights matching the requested date
							frappe.logger().warning(f"Could not extract date from flight data for {flight_number}, skipping flight as date filter was requested")
							continue
					
					matching_flights.append(flight)
			
			if matching_flights:
				return {
					"success": True,
					"data": matching_flights,
					"count": len(matching_flights),
				}
			elif flight_date:
				# If date was specified but no flights matched, return error
				return {
					"success": False,
					"error": f"No flight found for {flight_number} on {flight_date}",
					"debug_info": f"Found flights but none matched the requested date {flight_date}"
				}
			elif flights:
				# Return all flights if no exact match (might be multi-leg flights)
				return {
					"success": True,
					"data": flights,
					"count": len(flights),
					"debug_info": "Returned all flights (may include multi-leg flights)"
				}
			else:
				return {
					"success": False,
					"error": f"No flight found for {flight_number}",
					"debug_info": f"API Response: {str(data)[:300]}"
				}
		
		elif response.status_code == 401:
			return {
				"success": False,
				"error": "Unauthorized - Invalid API Key",
				"error_details": "Please check your API Key in Aerodata Settings",
			}
		
		elif response.status_code == 403:
			return {
				"success": False,
				"error": "Forbidden - API access denied",
				"error_details": "Your API key may not have permission to access this endpoint",
			}
		
		elif response.status_code == 404:
			return {
				"success": False,
				"error": f"Flight {flight_number} not found",
				"error_details": "The flight may not exist in the Aerodata database",
			}
		
		elif response.status_code == 429:
			return {
				"success": False,
				"error": "Rate limit exceeded",
				"error_details": "Too many requests. Please try again later.",
			}
		
		else:
			return {
				"success": False,
				"error": f"API request failed with status {response.status_code}",
				"error_details": response.text[:500] if response.text else "No error details available",
				"debug_info": f"Response: {response.text[:300]}"
			}
	
	except frappe.DoesNotExistError:
		return {
			"success": False,
			"error": "Aerodata Settings not found",
			"error_details": "Please create and configure Aerodata Settings first",
		}
	
	except requests.exceptions.Timeout:
		return {
			"success": False,
			"error": "Request timeout",
			"error_details": "The API request took too long. Please try again.",
		}
	
	except requests.exceptions.ConnectionError:
		return {
			"success": False,
			"error": "Connection error",
			"error_details": "Could not connect to Aerodata API. Please check your internet connection.",
		}
	
	except Exception as e:
		frappe.log_error(f"Aerodata API Error: {str(e)}", "Aerodata API Error")
		return {
			"success": False,
			"error": "An unexpected error occurred",
			"error_details": str(e),
		}


@frappe.whitelist()
def test_connection():
	"""
	Test the connection to Aerodata API
	
	Returns:
		dict: Connection test results
	"""
	try:
		settings = frappe.get_single("Aerodata Settings")
		
		if not settings.enabled:
			return {
				"success": False,
				"error": "Aerodata integration is not enabled",
			}
		
		if not settings.api_key:
			return {
				"success": False,
				"error": "API Key is not configured",
			}
		
		api_key = settings.get_password("api_key")
		api_endpoint = settings.api_endpoint or "https://prod.api.market/api/v1/aedbx/aerodatabox"
		
		# Make a simple test request with a common flight number
		# Using a test flight number that should exist
		url = f"{api_endpoint}/flights/Number/AA100"
		params = {
			"dateLocalRole": "Both",
			"withAircraftImage": "false",
			"withLocation": "false"
		}
		
		headers = {
			"accept": "application/json",
			"x-api-market-key": api_key
		}
		
		response = requests.get(url, params=params, headers=headers, timeout=10)
		
		if response.status_code == 200:
			return {
				"success": True,
				"message": "Successfully connected to Aerodata API",
				"endpoint": api_endpoint,
			}
		elif response.status_code == 401:
			return {
				"success": False,
				"error": "Invalid API Key",
				"error_details": "Please verify your API Key in Aerodata Settings",
			}
		elif response.status_code == 403:
			return {
				"success": False,
				"error": "Forbidden - API access denied",
				"error_details": "Your API key may not have permission to access this endpoint",
			}
		else:
			# Even if the test flight doesn't exist, if we get a proper response, the API is working
			if response.status_code in [404]:
				return {
					"success": True,
					"message": "API connection successful (test flight not found, but API is responding)",
					"endpoint": api_endpoint,
				}
			return {
				"success": False,
				"error": f"Connection test failed with status {response.status_code}",
				"error_details": response.text[:500] if response.text else "No error details available",
			}
	
	except frappe.DoesNotExistError:
		return {
			"success": False,
			"error": "Aerodata Settings not found",
			"error_details": "Please create and configure Aerodata Settings first",
		}
	
	except Exception as e:
		frappe.log_error(f"Aerodata Connection Test Error: {str(e)}", "Aerodata Connection Test")
		return {
			"success": False,
			"error": "Connection test failed",
			"error_details": str(e),
		}

