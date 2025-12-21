# Copyright (c) 2025, Next Layer and contributors
# For license information, please see license.txt

import frappe
import requests
from frappe import _


@frappe.whitelist()
def get_flight_details(flight_number, lookup_type="flight", flight_date=None):
	"""
	Get flight details from Aviation Stack API
	
	Args:
		flight_number: Flight number (IATA or ICAO code, e.g., D3189, D3186)
		lookup_type: Type of lookup - 'flight' or 'ticket' (deprecated, always uses flight)
		flight_date: Optional date in YYYY-MM-DD format to search for specific date
	
	Returns:
		dict: Flight information or error details
	"""
	try:
		# Get settings
		settings = frappe.get_single("Aviation Stack Settings")
		
		if not settings.enabled:
			return {
				"success": False,
				"error": "Aviation Stack integration is not enabled",
			}
		
		if not settings.api_access_key:
			return {
				"success": False,
				"error": "API Access Key is not configured",
			}
		
		api_key = settings.get_password("api_access_key")
		api_endpoint = settings.api_endpoint or "https://api.aviationstack.com/v1"
		
		flight_number_upper = flight_number.upper().strip()
		
		# Try multiple approaches to find the flight
		# Approach 1: Try with flight_iata parameter
		url = f"{api_endpoint}/flights"
		params_list = []
		
		# Try different parameter combinations
		if flight_date:
			# With date and IATA
			params_list.append({
				"access_key": api_key,
				"flight_iata": flight_number_upper,
				"flight_date": flight_date,
				"limit": 100
			})
			# With date and ICAO
			params_list.append({
				"access_key": api_key,
				"flight_icao": flight_number_upper,
				"flight_date": flight_date,
				"limit": 100
			})
		else:
			# Without date - try IATA first
			params_list.append({
				"access_key": api_key,
				"flight_iata": flight_number_upper,
				"limit": 100
			})
			# Try ICAO
			params_list.append({
				"access_key": api_key,
				"flight_icao": flight_number_upper,
				"limit": 100
			})
			# Try searching by flight number (some APIs use this)
			params_list.append({
				"access_key": api_key,
				"flight_number": flight_number_upper,
				"limit": 100
			})
		
		# Try each approach
		last_error = None
		last_response_data = None
		
		for params in params_list:
			try:
				response = requests.get(url, params=params, timeout=30)
				
				if response.status_code == 200:
					data = response.json()
					
					# Log the response for debugging
					frappe.logger().info(f"Aviation Stack API Response: {str(data)[:500]}")
					
					# Check for API errors in response
					if "error" in data:
						last_error = data.get("error", {}).get("info", "API returned an error")
						last_response_data = data
						continue
					
					# Check if we have flight data
					flights = data.get("data", [])
					
					if flights:
						# Filter flights that match our flight number (in case API returns multiple)
						matching_flights = []
						for flight in flights:
							flight_info = flight.get("flight", {})
							flight_iata = flight_info.get("iata", "").upper()
							flight_icao = flight_info.get("icao", "").upper()
							flight_number_code = flight_info.get("number", "").upper()
							
							if (flight_iata == flight_number_upper or 
								flight_icao == flight_number_upper or
								flight_number_code == flight_number_upper or
								flight_number_upper in flight_iata or
								flight_number_upper in flight_icao):
								matching_flights.append(flight)
						
						if matching_flights:
							return {
								"success": True,
								"data": matching_flights,
								"count": len(matching_flights),
								"debug_info": f"Found using params: {list(params.keys())}"
							}
						
						# If no exact match but we have flights, return them anyway
						if flights:
							return {
								"success": True,
								"data": flights,
								"count": len(flights),
								"debug_info": f"Found flights (may not be exact match) using params: {list(params.keys())}"
							}
					
					last_response_data = data
				elif response.status_code == 401:
					# Unauthorized - stop trying other methods
					return {
						"success": False,
						"error": "Unauthorized - Invalid API Access Key",
						"error_details": "Please check your API Access Key in Aviation Stack Settings",
					}
				elif response.status_code == 403:
					# Forbidden - stop trying other methods
					return {
						"success": False,
						"error": "Forbidden - API access denied",
						"error_details": "Your API key may not have permission to access this endpoint",
					}
				elif response.status_code == 429:
					# Rate limit - stop trying other methods
					return {
						"success": False,
						"error": "Rate limit exceeded",
						"error_details": "Too many requests. Please try again later.",
					}
				else:
					last_error = f"HTTP {response.status_code}: {response.text[:200]}"
					
			except Exception as e:
				frappe.logger().error(f"Aviation Stack API request error: {str(e)}")
				last_error = str(e)
				continue
		
		# If we get here, none of the approaches worked
		# Try a broader search without flight number filter
		if not flight_date:
			try:
				# Search without flight number filter and filter manually
				# This is a fallback - might return many results
				broad_params = {
					"access_key": api_key,
					"limit": 1000  # Get more results to search through
				}
				
				response = requests.get(url, params=broad_params, timeout=30)
				if response.status_code == 200:
					data = response.json()
					flights = data.get("data", [])
					
					if flights:
						# Search through results for matching flight number
						matching_flights = []
						for flight in flights:
							flight_info = flight.get("flight", {})
							flight_iata = flight_info.get("iata", "").upper()
							flight_icao = flight_info.get("icao", "").upper()
							flight_number_code = flight_info.get("number", "").upper()
							
							if (flight_iata == flight_number_upper or 
								flight_icao == flight_number_upper or
								flight_number_code == flight_number_upper):
								matching_flights.append(flight)
						
						if matching_flights:
							return {
								"success": True,
								"data": matching_flights,
								"count": len(matching_flights),
								"debug_info": "Found using broad search"
							}
			except:
				pass
		
		# Return error with debug information
		error_msg = f"No flight found for {flight_number}"
		if flight_date:
			error_msg += f" on {flight_date}"
		
		debug_info = ""
		if last_response_data:
			debug_info = f"\nAPI Response: {str(last_response_data)[:300]}"
		
		return {
			"success": False,
			"error": error_msg,
			"error_details": last_error or "No matching flights found",
			"debug_info": debug_info,
			"tried_params": [list(p.keys()) for p in params_list]
		}
	
	except frappe.DoesNotExistError:
		return {
			"success": False,
			"error": "Aviation Stack Settings not found",
			"error_details": "Please create and configure Aviation Stack Settings first",
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
			"error_details": "Could not connect to Aviation Stack API. Please check your internet connection.",
		}
	
	except Exception as e:
		frappe.log_error(f"Aviation Stack API Error: {str(e)}", "Aviation Stack API Error")
		return {
			"success": False,
			"error": "An unexpected error occurred",
			"error_details": str(e),
		}


@frappe.whitelist()
def test_connection():
	"""
	Test the connection to Aviation Stack API
	
	Returns:
		dict: Connection test results
	"""
	try:
		settings = frappe.get_single("Aviation Stack Settings")
		
		if not settings.enabled:
			return {
				"success": False,
				"error": "Aviation Stack integration is not enabled",
			}
		
		if not settings.api_access_key:
			return {
				"success": False,
				"error": "API Access Key is not configured",
			}
		
		api_key = settings.get_password("api_access_key")
		api_endpoint = settings.api_endpoint or "https://api.aviationstack.com/v1"
		
		# Make a simple test request to check API key validity
		url = f"{api_endpoint}/flights"
		params = {
			"access_key": api_key,
			"limit": 1,  # Just get one result for testing
		}
		
		response = requests.get(url, params=params, timeout=10)
		
		if response.status_code == 200:
			data = response.json()
			
			if "error" in data:
				return {
					"success": False,
					"error": data.get("error", {}).get("info", "API returned an error"),
					"error_details": str(data.get("error", {})),
				}
			
			return {
				"success": True,
				"message": "Successfully connected to Aviation Stack API",
				"endpoint": api_endpoint,
			}
		
		elif response.status_code == 401:
			return {
				"success": False,
				"error": "Invalid API Access Key",
				"error_details": "Please verify your API Access Key in Aviation Stack Settings",
			}
		
		else:
			return {
				"success": False,
				"error": f"Connection test failed with status {response.status_code}",
				"error_details": response.text[:500] if response.text else "No error details available",
			}
	
	except frappe.DoesNotExistError:
		return {
			"success": False,
			"error": "Aviation Stack Settings not found",
			"error_details": "Please create and configure Aviation Stack Settings first",
		}
	
	except Exception as e:
		frappe.log_error(f"Aviation Stack Connection Test Error: {str(e)}", "Aviation Stack Connection Test")
		return {
			"success": False,
			"error": "Connection test failed",
			"error_details": str(e),
		}


@frappe.whitelist()
def get_flight_by_date(flight_number, date=None):
	"""
	Get flight details for a specific date
	
	Args:
		flight_number: Flight number (IATA or ICAO)
		date: Date in YYYY-MM-DD format (optional, defaults to today)
	
	Returns:
		dict: Flight information or error details
	"""
	try:
		settings = frappe.get_single("Aviation Stack Settings")
		
		if not settings.enabled:
			return {
				"success": False,
				"error": "Aviation Stack integration is not enabled",
			}
		
		api_key = settings.get_password("api_access_key")
		api_endpoint = settings.api_endpoint or "https://api.aviationstack.com/v1"
		
		url = f"{api_endpoint}/flights"
		params = {
			"access_key": api_key,
			"flight_iata": flight_number.upper(),
		}
		
		if date:
			params["flight_date"] = date
		
		response = requests.get(url, params=params, timeout=30)
		
		if response.status_code == 200:
			data = response.json()
			
			if "error" in data:
				return {
					"success": False,
					"error": data.get("error", {}).get("info", "API returned an error"),
				}
			
			flights = data.get("data", [])
			
			if not flights:
				return {
					"success": False,
					"error": f"No flight found for {flight_number} on {date or 'specified date'}",
				}
			
			return {
				"success": True,
				"data": flights,
				"count": len(flights),
			}
		
		else:
			return {
				"success": False,
				"error": f"API request failed with status {response.status_code}",
				"error_details": response.text[:500] if response.text else "No error details available",
			}
	
	except Exception as e:
		frappe.log_error(f"Aviation Stack API Error: {str(e)}", "Aviation Stack API Error")
		return {
			"success": False,
			"error": "An unexpected error occurred",
			"error_details": str(e),
		}

