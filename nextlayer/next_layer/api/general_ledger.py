
# api/general_ledger.py
import frappe
from frappe import _
from frappe.utils import flt
from nextlayer.next_layer.report.general_ledger_extension.general_ledger_extension import execute
from frappe import _dict
from frappe.utils.password import get_decrypted_password


@frappe.whitelist()
def get_general_ledger_data(filters):
	try:
		if isinstance(filters, str):
			filters = frappe.parse_json(filters)

		filters = _dict(filters)

		# Create cache key for opening entries
		cache_key = f"gl_data_{filters.get('company')}_{filters.get('from_date')}_{filters.get('to_date')}_{filters.get('party')}_{filters.get('show_opening_entries', 0)}"

		# Try to get from cache first
		cached_data = frappe.cache().get_value(cache_key)
		if cached_data:
			return cached_data

		# Validate required fields
		if not filters.get("company"):
			frappe.throw(_("Company is required"))

		if not filters.get("from_date") or not filters.get("to_date"):
			frappe.throw(_("From Date and To Date are required"))

		# Skip company permission check - allow access to all companies for reconciliation
		filters.setdefault("show_remarks", 1)
		filters.setdefault("categorize_by", "Categorize by Voucher (Consolidated)")
		filters.setdefault("include_dimensions", 1)
		filters.setdefault("include_default_book_entries", 1)

		if filters.get("currency"):
			filters.setdefault("presentation_currency", filters.get("currency"))
			filters.setdefault("account_currency", filters.get("currency"))

		else:
			company_currency = frappe.get_cached_value("Company", filters.get("company"), "default_currency")
			filters.setdefault("company_currency", company_currency)
			filters.setdefault("account_currency", company_currency)

		filters.setdefault("company_fb", "")

		# Run with elevated permissions to bypass all restrictions
		original_user = frappe.session.user
		try:
			frappe.set_user("Administrator")
			columns, data = execute(filters)
		finally:
			frappe.set_user(original_user)
		# Format the response
		result = {
			"success": True,
			"data": {
				"columns": columns,
				"entries": data,
				"filters_applied": filters,
				"total_entries": len(data),
			},
		}

		# Cache the result for 5 minutes
		frappe.cache().set_value(cache_key, result, expires_in_sec=300)

		return result

	except Exception as e:
		frappe.log_error(f"General Ledger API Error: {str(e)}")
		return {
			"success": False,
			"error": str(e),
			"message": _("Failed to fetch General Ledger data"),
		}


@frappe.whitelist()
def get_permission_aware_gl_data(filters):
	"""
	Enhanced GL data API that bypasses all permission checks for reconciliation
	Returns all entries without permission filtering
	"""

	try:
		if isinstance(filters, str):
			filters = frappe.parse_json(filters)

		filters = _dict(filters)

		# Validate required fields
		if not filters.get("company"):
			frappe.throw(_("Company is required"))

		if not filters.get("from_date") or not filters.get("to_date"):
			frappe.throw(_("From Date and To Date are required"))

		# Set default values
		filters.setdefault("show_remarks", 1)
		filters.setdefault("categorize_by", "Categorize by Voucher (Consolidated)")
		filters.setdefault("include_dimensions", 1)
		filters.setdefault("include_default_book_entries", 1)

		if filters.get("currency"):
			filters.setdefault("presentation_currency", filters.get("currency"))
			filters.setdefault("account_currency", filters.get("currency"))
		else:
			company_currency = frappe.get_cached_value("Company", filters.get("company"), "default_currency")
			filters.setdefault("company_currency", company_currency)
			filters.setdefault("account_currency", company_currency)

		filters.setdefault("company_fb", "")

		# Convert party string to array format expected by execute function
		if filters.get("party") and isinstance(filters.get("party"), str):
			filters["party"] = [filters.get("party")]

		# Run with elevated permissions to bypass all restrictions
		original_user = frappe.session.user

		try:
			frappe.set_user("Administrator")
			# Get all GL data first
			columns, all_data = execute(filters)
		finally:
			frappe.set_user(original_user)
		frappe.set_user(original_user)
		# Filter based on document sharing permissions for display
		# Run permission checks as the original user to respect sharing permissions
		visible_entries = []
		hidden_summary = {
			"Sales Invoice": {"count": 0, "total_debit": 0, "total_credit": 0},
			"Purchase Invoice": {"count": 0, "total_debit": 0, "total_credit": 0},
			"Journal Entry": {"count": 0, "total_debit": 0, "total_credit": 0},
			"Payment Entry": {"count": 0, "total_debit": 0, "total_credit": 0}
		}

		processed_count = 0
		hidden_count = 0
		for entry in all_data:
			# Skip summary rows
			if (isinstance(entry.get('account'), str) and
				('Opening' in entry.get('account', '') or
				 'Total' in entry.get('account', '') or
				 'Closing' in entry.get('account', ''))):
				continue

			if not entry.get('posting_date'):
				continue

			voucher_type = entry.get('voucher_type', '')
			voucher_no = entry.get('voucher_no', '')
			processed_count += 1

			# Check if user has permission to view this document (for display purposes)
			# This check runs as the original user to respect sharing permissions
			if voucher_type and voucher_no:
				has_permission = check_document_permission_as_original_user(voucher_type, voucher_no, original_user)
				company = entry.get('party', 'Unknown')

				if has_permission:
					# User has permission - show full document details in entries list
					visible_entries.append(entry)
				else:
					# Only add to hidden summary for reconciliation totals
					hidden_count += 1

					# Add to hidden summary for reporting
					if voucher_type in hidden_summary:
						hidden_summary[voucher_type]["count"] += 1
						hidden_summary[voucher_type]["total_debit"] += flt(entry.get('debit', 0))
						hidden_summary[voucher_type]["total_credit"] += flt(entry.get('credit', 0))
			else:
				# Include entries without voucher info
				visible_entries.append(entry)

		return {
			"success": True,
			"data": {
				"columns": columns,
				"entries": visible_entries,
				"hidden_summary": hidden_summary,
				"filters_applied": filters,
				"total_visible_entries": len(visible_entries),
				"total_hidden_entries": sum(doc_type["count"] for doc_type in hidden_summary.values())
			},
		}

	except Exception as e:
		frappe.log_error(f"Permission-Aware GL API Error: {str(e)}")
		return {
			"success": False,
			"error": str(e),
			"message": _("Failed to fetch General Ledger data"),
		}

def check_document_permission_as_original_user(voucher_type, voucher_no, original_user):
	try:
		if not frappe.db.exists(voucher_type, voucher_no):
			return False

		# Temporarily switch to the original user to check permissions
		current_user = frappe.session.user
		try:
			frappe.set_user(original_user)
			# Now check permissions as the original user
			doc = frappe.get_doc(voucher_type, voucher_no)
			return frappe.has_permission(doc, ptype="read")
		finally:
			frappe.set_user(current_user)

	except frappe.PermissionError:
		return False
	except Exception as e:
		frappe.log_error(
			f"Permission check error for {voucher_type} {voucher_no} as user {original_user}: {str(e)}"
		)
		return False


@frappe.whitelist()
def get_companies():
	"""Get list of companies for dropdown based on user permissions"""
	try:

		companies = frappe.get_all(
			"Company",
			fields=["name", "default_currency"],
			order_by="name"
		)
		return {"success": True, "data": companies}

	except Exception as e:
		frappe.log_error(f"get_companies API Error: {frappe.get_traceback()}")
		return {
			"success": False,
			"error": str(e),
			"message": "Failed to fetch companies"
		}


@frappe.whitelist()
def get_all_companies_for_ui():
	"""
	Get ALL companies for UI dropdown purposes - bypasses permission checks
	This allows users to see all companies in dropdowns for auto-fill purposes
	Data access is still controlled by permissions in other APIs
	"""
	try:
		# First try to get companies
		companies = frappe.get_all(
			"Company",
			fields=["name", "default_currency"],
			order_by="name"
		)

		# If no companies found, return empty array
		if not companies:
			return {"success": True, "data": []}

		return {"success": True, "data": companies}

	except Exception as e:
		frappe.log_error(f"get_all_companies_for_ui API Error: {frappe.get_traceback()}")
		return {
			"success": False,
			"error": str(e),
			"message": f"Failed to fetch all companies for UI: {str(e)}"
		}


@frappe.whitelist()
def get_parties(party_type="Customer", company=None):
	"""Get list of parties (customers/suppliers) for dropdown"""
	try:
		# Skip company permission check - allow access to all companies for reconciliation
		
		filters = {}

		# add internal customer/supplier filter
		if party_type == "Customer":
			filters["is_internal_customer"] = 1
			fields = ["name", "customer_name as party_name", "default_currency"]
		elif party_type == "Supplier":
			filters["is_internal_supplier"] = 1
			fields = ["name", "supplier_name as party_name", "default_currency"]
		else:
			frappe.throw("Invalid party_type. Must be 'Customer' or 'Supplier'")

		parties = frappe.get_all(
			party_type,
			fields=fields,
			filters=filters,
			order_by="name"
		)

		return {"success": True, "data": parties}

	except Exception as e:
		frappe.log_error(f"get_parties API Error: {str(e)}")
		return {
			"success": False,
			"error": str(e),
			"message": f"Failed to fetch {party_type} parties"
		}


@frappe.whitelist()
def get_parties_for_autofill(party_type="Customer", company=None):
	"""
	Get list of parties for auto-fill purposes - bypasses company permission checks
	This allows users to auto-fill party selections even if they don't have permission to the company
	"""
	try:
		filters = {}

		# add internal customer/supplier filter
		if party_type == "Customer":
			filters["is_internal_customer"] = 1
			fields = ["name", "customer_name as party_name", "default_currency"]
		elif party_type == "Supplier":
			filters["is_internal_supplier"] = 1
			fields = ["name", "supplier_name as party_name", "default_currency"]
		else:
			frappe.throw("Invalid party_type. Must be 'Customer' or 'Supplier'")

		parties = frappe.get_all(
			party_type,
			fields=fields,
			filters=filters,
			order_by="name"
		)

		return {"success": True, "data": parties}

	except Exception as e:
		frappe.log_error(f"get_parties_for_autofill API Error: {str(e)}")
		return {
			"success": False,
			"error": str(e),
			"message": f"Failed to fetch {party_type} parties for auto-fill"
		}


@frappe.whitelist()
def update_match_status():
	"""Update match status for GL entries by updating the original document"""
	try:
		raw_data = frappe.request.get_data()
		data_string = raw_data.decode('utf-8')
		data = frappe.parse_json(data_string)

		if not isinstance(data, dict):
			frappe.throw(f"Expected dictionary data, got {type(data)}")
		print("Data received for update_match_status:", data)
		voucher_type = data.get("voucher_type")
		voucher_no = data.get("voucher_no")
		company = data.get("company")
		match_status = data.get("status")
		matched_with = data.get("matched_with")


		if not all([voucher_type, voucher_no, company, match_status]):
			frappe.throw("Missing required fields: voucher_type, voucher_no, company, status")

		# Check if document exists
		if not frappe.db.exists(voucher_type, voucher_no):
			frappe.throw(f"Document {voucher_type} {voucher_no} not found")

		matched_with_value = matched_with
		if isinstance(matched_with, dict):
			matched_with_value = frappe.as_json(matched_with)


		update_data = {
			"intercompany_match_status": match_status,
			"intercompany_matched_with": matched_with_value,
			"intercompany_matched_by": frappe.session.user,
			"intercompany_matched_on": frappe.utils.now()
		}

		# Add retry logic for concurrency issues
		max_retries = 3
		retry_count = 0

		while retry_count < max_retries:
			try:
				frappe.db.set_value(
					voucher_type,
					voucher_no,
					update_data
				)
				frappe.db.commit()
				frappe.logger().info(f"Successfully updated {voucher_type} {voucher_no}")
				break

			except frappe.QueryDeadlockError as e:
				retry_count += 1

				if retry_count >= max_retries:
					frappe.logger().error(f"Max retries reached for {voucher_type} {voucher_no}")
					raise e

				# Wait a bit before retrying (exponential backoff)
				import time
				time.sleep(0.1 * (2 ** retry_count))

			except Exception as e:
				# For non-concurrency errors, don't retry
				raise e

		return {
			"success": True,
			"message": f"Match status updated to {match_status}",
			"doc_name": voucher_no
		}

	except Exception as e:
		frappe.log_error(f"Update Match Status Error: {str(e)}")
		frappe.logger().error(f"Exception details: {type(e).__name__}: {str(e)}")
		frappe.logger().error(f"Request data: {frappe.request.get_data()}")
		return {
			"success": False,
			"error": str(e),
			"message": "Failed to update match status"
		}


@frappe.whitelist()
def get_match_status(voucher_type, voucher_no, company):
	"""Get current match status for a voucher from the original document"""
	try:
		try:
			doc = frappe.get_doc(voucher_type, voucher_no)

			# Get the basic match status
			matched_with_raw = doc.get("intercompany_matched_with")
			matched_with_parsed = None

			# Try to parse the matched_with data if it exists
			if matched_with_raw:
				try:
					matched_with_parsed = frappe.parse_json(matched_with_raw)
				except:
					
					matched_with_parsed = matched_with_raw

			return {
				"success": True,
				"status": doc.get("intercompany_match_status", "Pending"),
				"matched_with": matched_with_raw, 
				"matched_with_parsed": matched_with_parsed,
				"matched_by": doc.get("intercompany_matched_by"),
				"matched_on": doc.get("intercompany_matched_on")
			}
		except frappe.DoesNotExistError:
			return {
				"success": True,
				"status": "Pending",
				"matched_with": None,
				"matched_with_parsed": None,
				"matched_by": None,
				"matched_on": None
			}

	except Exception as e:
		frappe.log_error(f"Get Match Status Error: {str(e)}")
		return {
			"success": False,
			"error": str(e),
			"message": "Failed to get match status"
		}


def format_gl_entries_for_frontend(data, columns):
	"""
	Format the GL entries data from the report for frontend consumption
	Removes summary rows and structures data properly
	"""
	formatted_entries = []

	for entry in data:
		# Skip summary rows (Opening, Total, Closing)
		if (isinstance(entry.get('account'), str) and
			('Opening' in entry.get('account', '') or
			 'Total' in entry.get('account', '') or
			 'Closing' in entry.get('account', ''))):
			continue

		if not entry.get('posting_date'):
			continue

		formatted_entry = {
			'gl_entry': entry.get('gl_entry'),
			'posting_date': str(entry.get('posting_date', '')),
			'account': entry.get('account', ''),
			'voucher_type': entry.get('voucher_type', ''),
			'voucher_no': entry.get('voucher_no', ''),
			'debit': flt(entry.get('debit', 0)),
			'credit': flt(entry.get('credit', 0)),
			'balance': flt(entry.get('balance', 0)),
			'against': entry.get('against', ''),
			'remarks': entry.get('remarks', ''),
			'party_type': entry.get('party_type', ''),
			'party': entry.get('party', ''),
			'cost_center': entry.get('cost_center', ''),
			'project': entry.get('project', ''),
			'currency': entry.get('currency', 'INR')
		}

		formatted_entries.append(formatted_entry)

	return formatted_entries


def validate_intercompany_filters(filters):
	"""
	Validate filters specifically for intercompany reconciliation
	"""
	required_fields = ['company', 'party_type', 'party', 'from_date', 'to_date']

	for field in required_fields:
		if not filters.get(field):
			frappe.throw(f"{field.replace('_', ' ').title()} is required")

		# Ensure party is a list
		if filters.get('party') and not isinstance(filters.get('party'), list):
				filters['party'] = [filters.get('party')]

		return filters


@frappe.whitelist()
def get_permission_aware_companies():
	"""Get companies that the current user has permission to access"""
	try:
		# Get companies that user has permission to access
		companies = frappe.get_all("Company",
			fields=["name", "company_name"],
			order_by="name"
		)

		# Get user permitted companies
		user_permitted = frappe.permissions.get_user_permissions(frappe.session.user)

		# Extract permitted company names from the permission data
		permitted_company_names = []
		if user_permitted and "Company" in user_permitted:
			permitted_company_names = [perm.get("doc") for perm in user_permitted["Company"]]

		# If user has specific company permissions, filter accordingly
		if permitted_company_names:
			allowed_companies = []
			for company in companies:
				if company.name in permitted_company_names:
					allowed_companies.append({
						"name": company.name,
						"company_name": company.company_name
					})
		else:
			# If no specific permissions, show all companies
			allowed_companies = []
			for company in companies:
				allowed_companies.append({
					"name": company.name,
					"company_name": company.company_name
				})

		return {
			"success": True,
			"companies": allowed_companies
		}

	except Exception as e:
		frappe.log_error(f"Get Permission Aware Companies Error: {str(e)}")
		# Fallback: return all companies if there's an error
		try:
			companies = frappe.get_all("Company",
				fields=["name", "company_name"],
				order_by="name"
			)
			return {
				"success": True,
				"companies": [{"name": c.name, "company_name": c.company_name} for c in companies]
			}
		except:
			return {
				"success": False,
				"error": str(e),
				"companies": []
			}


@frappe.whitelist()
def verify_admin_password_and_get_hidden_transactions(admin_password, company_a, company_b, party_a, party_b, party_type_b, from_date, to_date, currency="all", ignore_exchange_rate_revaluation=True, ignore_system_generated_notes=True, show_opening_entries=False):
	"""
	Verify admin password from Global Defaults and return hidden transactions for both companies
	"""
	try:
		# Get the admin password from Global Defaults
		global_defaults = frappe.get_single("Global Defaults")
		stored_password = get_decrypted_password(
    "Global Defaults",   # Doctype
    "Global Defaults",   # Docname (same as Doctype for Single DocTypes)
    "custom_admin_password"  # Fieldname
)
		print("Stored password fetched", stored_password)
		if not stored_password:
			frappe.throw(_("Admin password not configured in Global Defaults"))

		# Verify the password
		if admin_password != stored_password:
			frappe.throw(_("Invalid admin password"))
		else:
			print("Admin password verified successfully")
		hidden_transactions_a = []
		hidden_transactions_b = []

		# Get hidden transactions for Company A
		if company_a and party_a:
			filters_a = _dict({
				"company": company_a,
				"party_type": "Customer",
				"party": [party_a],  # Convert to list format
				"from_date": from_date,
				"to_date": to_date,
				"currency": currency,
				"ignore_exchange_rate_revaluation": ignore_exchange_rate_revaluation,
				"ignore_system_generated_notes": ignore_system_generated_notes,
				"show_opening_entries": show_opening_entries
			})

			# Get all GL data for Company A (including hidden ones)
			original_user = frappe.session.user
			try:
				frappe.set_user("Administrator")
				columns_a, all_data_a = execute(filters_a)
			finally:
				frappe.set_user(original_user)

			# Filter to get only hidden transactions (those user doesn't have permission to see)
			for entry in all_data_a:
				# Skip summary rows
				if (isinstance(entry.get('account'), str) and
					('Opening' in entry.get('account', '') or
					 'Total' in entry.get('account', '') or
					 'Closing' in entry.get('account', ''))):
					continue

				if not entry.get('posting_date'):
					continue

				voucher_type = entry.get('voucher_type', '')
				voucher_no = entry.get('voucher_no', '')

				# Check if user has permission to view this document
				if voucher_type and voucher_no:
					has_permission = check_document_permission_as_original_user(voucher_type, voucher_no, original_user)

					if not has_permission:
						# This is a hidden transaction - add it to the list
						formatted_entry = format_gl_entries_for_frontend([entry], columns_a)[0]
						formatted_entry['is_hidden'] = True
						hidden_transactions_a.append(formatted_entry)

		# Get hidden transactions for Company B
		if company_b and party_b:
			filters_b = _dict({
				"company": company_b,
				"party_type": party_type_b,
				"party": [party_b],  # Convert to list format
				"from_date": from_date,
				"to_date": to_date,
				"currency": currency,
				"ignore_exchange_rate_revaluation": ignore_exchange_rate_revaluation,
				"ignore_system_generated_notes": ignore_system_generated_notes,
				"show_opening_entries": show_opening_entries
			})

			# Get all GL data for Company B (including hidden ones)
			original_user = frappe.session.user
			try:
				frappe.set_user("Administrator")
				columns_b, all_data_b = execute(filters_b)
			finally:
				frappe.set_user(original_user)

			# Filter to get only hidden transactions (those user doesn't have permission to see)
			for entry in all_data_b:
				# Skip summary rows
				if (isinstance(entry.get('account'), str) and
					('Opening' in entry.get('account', '') or
					 'Total' in entry.get('account', '') or
					 'Closing' in entry.get('account', ''))):
					continue

				if not entry.get('posting_date'):
					continue

				voucher_type = entry.get('voucher_type', '')
				voucher_no = entry.get('voucher_no', '')

				# Check if user has permission to view this document
				if voucher_type and voucher_no:
					has_permission = check_document_permission_as_original_user(voucher_type, voucher_no, original_user)

					if not has_permission:
						# This is a hidden transaction - add it to the list
						formatted_entry = format_gl_entries_for_frontend([entry], columns_b)[0]
						formatted_entry['is_hidden'] = True
						hidden_transactions_b.append(formatted_entry)

		return {
			"success": True,
			"hidden_transactions_a": hidden_transactions_a,
			"hidden_transactions_b": hidden_transactions_b,
			"total_hidden_a": len(hidden_transactions_a),
			"total_hidden_b": len(hidden_transactions_b)
		}

	except Exception as e:
		frappe.log_error(f"Verify Admin Password Error: {str(e)}")
		return {
			"success": False,
			"error": str(e),
			"message": _("Failed to verify admin password or fetch hidden transactions")
		}
