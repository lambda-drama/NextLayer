# Copyright (c) 2025, Next Layer and contributors
# For license information, please see license.txt

import frappe
from frappe import _


@frappe.whitelist()
def get_or_create_airline(airline_name, airline_iata=None, airline_icao=None):
	"""
	Get existing airline or create a new one if it doesn't exist
	
	Args:
		airline_name: Name of the airline
		airline_iata: IATA code (optional)
		airline_icao: ICAO code (optional)
	
	Returns:
		str: Name of the airline record (name1 field value)
	"""
	try:
		if not airline_name:
			return None
		
		# Get the Airlines doctype meta to check available fields
		meta = frappe.get_meta("Airlines")
		
		# Search for existing airline by name1 (which is the ID field)
		existing_airline = frappe.db.get_value("Airlines", {"name1": airline_name}, "name")
		
		if existing_airline:
			return existing_airline
		
		# Try searching by IATA code if provided
		if airline_iata:
			if meta.has_field("iata_code"):
				existing_airline = frappe.db.get_value("Airlines", {"iata_code": airline_iata}, "name")
			elif meta.has_field("iata"):
				existing_airline = frappe.db.get_value("Airlines", {"iata": airline_iata}, "name")
			if existing_airline:
				return existing_airline
		
		# Try searching by ICAO code if provided
		if airline_icao:
			if meta.has_field("icao_code"):
				existing_airline = frappe.db.get_value("Airlines", {"icao_code": airline_icao}, "name")
			elif meta.has_field("icao"):
				existing_airline = frappe.db.get_value("Airlines", {"icao": airline_icao}, "name")
			if existing_airline:
				return existing_airline
		
		# Create new airline - use airline_name as name1 (which is the ID)
		airline_data = {
			"doctype": "Airlines",
			"name1": airline_name,  # This is the ID field
		}
		
		# Set IATA code
		if airline_iata:
			if meta.has_field("iata_code"):
				airline_data["iata_code"] = airline_iata
			elif meta.has_field("iata"):
				airline_data["iata"] = airline_iata
		
		# Set ICAO code
		if airline_icao:
			if meta.has_field("icao_code"):
				airline_data["icao_code"] = airline_icao
			elif meta.has_field("icao"):
				airline_data["icao"] = airline_icao
		
		airline_doc = frappe.get_doc(airline_data)
		airline_doc.insert(ignore_permissions=True)
		
		frappe.db.commit()
		
		return airline_doc.name
		
	except frappe.DuplicateEntryError:
		# If duplicate, get the existing one
		return frappe.db.get_value("Airlines", {"name1": airline_name}, "name") or airline_name
	except Exception as e:
		frappe.log_error(f"Error creating airline: {str(e)}", "Flight Utils Error")
		# Return the name anyway, let the user handle it manually
		return airline_name


@frappe.whitelist()
def get_or_create_airport(airport_name, airport_iata=None, airport_icao=None, airport_city=None, airport_country=None):
	"""
	Get existing airport or create a new one if it doesn't exist
	
	Args:
		airport_name: Name of the airport
		airport_iata: IATA code (optional)
		airport_icao: ICAO code (optional)
		airport_city: City name (optional)
		airport_country: Country code (optional)
	
	Returns:
		str: Name of the airport record (name1 field value)
	"""
	try:
		if not airport_name:
			return None
		
		# Get the Airport doctype meta to check available fields
		meta = frappe.get_meta("Airport")
		
		# Search for existing airport by name1 (which is the ID field)
		existing_airport = frappe.db.get_value("Airport", {"name1": airport_name}, "name")
		
		if existing_airport:
			return existing_airport
		
		# Try searching by IATA code if provided
		if airport_iata:
			if meta.has_field("iata_code"):
				existing_airport = frappe.db.get_value("Airport", {"iata_code": airport_iata}, "name")
			elif meta.has_field("iata"):
				existing_airport = frappe.db.get_value("Airport", {"iata": airport_iata}, "name")
			if existing_airport:
				return existing_airport
		
		# Try searching by ICAO code if provided
		if airport_icao:
			if meta.has_field("icao_code"):
				existing_airport = frappe.db.get_value("Airport", {"icao_code": airport_icao}, "name")
			elif meta.has_field("icao"):
				existing_airport = frappe.db.get_value("Airport", {"icao": airport_icao}, "name")
			if existing_airport:
				return existing_airport
		
		# Create new airport - use airport_name as name1 (which is the ID)
		airport_data = {
			"doctype": "Airport",
			"name1": airport_name,  # This is the ID field
		}
		
		# Set IATA code
		if airport_iata:
			if meta.has_field("iata_code"):
				airport_data["iata_code"] = airport_iata
			elif meta.has_field("iata"):
				airport_data["iata"] = airport_iata
		
		# Set ICAO code
		if airport_icao:
			if meta.has_field("icao_code"):
				airport_data["icao_code"] = airport_icao
			elif meta.has_field("icao"):
				airport_data["icao"] = airport_icao
		
		# Set city
		if airport_city:
			if meta.has_field("city"):
				airport_data["city"] = airport_city
		
		# Set country
		if airport_country:
			if meta.has_field("country"):
				airport_data["country"] = airport_country
			elif meta.has_field("country_code"):
				airport_data["country_code"] = airport_country
		
		airport_doc = frappe.get_doc(airport_data)
		airport_doc.insert(ignore_permissions=True)
		
		frappe.db.commit()
		
		return airport_doc.name
		
	except frappe.DuplicateEntryError:
		# If duplicate, get the existing one
		return frappe.db.get_value("Airport", {"name1": airport_name}, "name") or airport_name
	except Exception as e:
		frappe.log_error(f"Error creating airport: {str(e)}", "Flight Utils Error")
		# Return the name anyway, let the user handle it manually
		return airport_name

