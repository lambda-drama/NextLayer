
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

		# Create cache key for opening entries - include all relevant filter parameters
		party_filter = filters.get('party')
		if isinstance(party_filter, list):
			party_filter = '_'.join(sorted(party_filter)) if party_filter else ''
		cache_key = f"gl_data_{filters.get('company')}_{filters.get('from_date')}_{filters.get('to_date')}_{party_filter}_{filters.get('show_opening_entries', 0)}_{filters.get('currency', '')}_{filters.get('ignore_err', 0)}_{filters.get('ignore_cr_dr_notes', 0)}"

		# Try to get from cache first
		cached_data = frappe.cache().get_value(cache_key)
		if cached_data:
			return cached_data

		# Validate required fields
		if not filters.get("company"):
			frappe.throw(_("Company is required"))

		if not filters.get("from_date") or not filters.get("to_date"):
			frappe.throw(_("From Date and To Date are required"))

		# Convert party string to array format expected by execute function (consistent with get_permission_aware_gl_data)
		if filters.get("party") and isinstance(filters.get("party"), str):
			filters["party"] = [filters.get("party")]

		# Skip company permission check - allow access to all companies for reconciliation
		filters.setdefault("show_remarks", 1)
		# Don't set group_by - let it be empty/None so GL report shows individual entries (like when group_by is blank in UI)
		# Only set if not already provided
		if "group_by" not in filters:
			filters["group_by"] = ""
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

		# Filter data - show_opening_entries is handled by the standard GL report
		filtered_data = []
		skipped_summary = 0
		skipped_no_date = 0
		for entry in data:
			voucher_type = entry.get('voucher_type', '')
			voucher_no = entry.get('voucher_no', '')
			posting_date = entry.get('posting_date')
			account = entry.get('account', '')

			# Skip summary rows
			if (isinstance(account, str) and
				('Opening' in account or
				 'Total' in account or
				 'Closing' in account)):
				skipped_summary += 1
				continue

			if not posting_date:
				skipped_no_date += 1
				continue

			filtered_data.append(entry)

		# Format the response
		result = {
			"success": True,
			"data": {
				"columns": columns,
				"entries": filtered_data,
				"filters_applied": filters,
				"total_entries": len(filtered_data),
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
		# Don't set group_by - let it be empty/None so GL report shows individual entries (like when group_by is blank in UI)
		# Only set if not already provided
		if "group_by" not in filters:
			filters["group_by"] = ""
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

		print(f"[get_permission_aware_gl_data] Total entries from GL report: {len(all_data)}")
		print(f"[get_permission_aware_gl_data] Filters: company={filters.get('company')}, party={filters.get('party')}, from_date={filters.get('from_date')}, to_date={filters.get('to_date')}")

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
		skipped_summary = 0
		skipped_no_date = 0
		skipped_opening = 0
		skipped_permission = 0
		# show_opening_entries is handled by the standard GL report
		for entry in all_data:
			voucher_type = entry.get('voucher_type', '')
			voucher_no = entry.get('voucher_no', '')
			posting_date = entry.get('posting_date')
			account = entry.get('account', '')

			# Skip summary rows
			if (isinstance(account, str) and
				('Opening' in account or
				 'Total' in account or
				 'Closing' in account)):
				skipped_summary += 1
				continue

			if not posting_date:
				skipped_no_date += 1
				print(f"[get_permission_aware_gl_data] Skipped entry (no posting_date): voucher={voucher_type}-{voucher_no}, account={account}")
				continue

			processed_count += 1

			# Check if user has permission to view this document (for display purposes)
			# This check runs as the original user to respect sharing permissions
			if voucher_type and voucher_no:
				has_permission = check_document_permission_as_original_user(voucher_type, voucher_no, original_user)
				company = entry.get('party', 'Unknown')

				if has_permission:
					# User has permission - show full document details in entries list
					print(f"[get_permission_aware_gl_data] Including entry (has permission): {voucher_type}-{voucher_no}, posting_date={posting_date}, debit={entry.get('debit', 0)}, credit={entry.get('credit', 0)}")
					visible_entries.append(entry)
				else:
					# Only add to hidden summary for reconciliation totals
					hidden_count += 1
					skipped_permission += 1
					print(f"[get_permission_aware_gl_data] Skipped entry (no permission): {voucher_type}-{voucher_no}, posting_date={posting_date}, debit={entry.get('debit', 0)}, credit={entry.get('credit', 0)}")

					# Add to hidden summary for reporting
					if voucher_type in hidden_summary:
						hidden_summary[voucher_type]["count"] += 1
						hidden_summary[voucher_type]["total_debit"] += flt(entry.get('debit', 0))
						hidden_summary[voucher_type]["total_credit"] += flt(entry.get('credit', 0))
			else:
				# Include entries without voucher info
				print(f"[get_permission_aware_gl_data] Including entry (no voucher info): posting_date={posting_date}, account={account}")
				visible_entries.append(entry)

		print(f"[get_permission_aware_gl_data] Filtering summary: total={len(all_data)}, skipped_summary={skipped_summary}, skipped_no_date={skipped_no_date}, skipped_opening={skipped_opening}, skipped_permission={skipped_permission}, final_visible={len(visible_entries)}, hidden={hidden_count}")

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
def get_permission_aware_parties(party_type="Customer"):
	"""Get parties that the current user has permission to access using doctype-level permissions"""
	try:
		# Get all parties of the specified type
		if party_type == "Customer":
			filters = {"is_internal_customer": 1, "disabled": 0}
			fields = ["name", "customer_name as party_name", "default_currency"]
		elif party_type == "Supplier":
			filters = {"is_internal_supplier": 1, "disabled": 0}
			fields = ["name", "supplier_name as party_name", "default_currency"]
		else:
			frappe.throw("Invalid party_type. Must be 'Customer' or 'Supplier'")

		parties = frappe.get_all(
			party_type,
			fields=fields,
			filters=filters,
			order_by="name"
		)

		# Filter parties based on doctype-level permissions using frappe.has_permission()
		allowed_parties = []
		for party in parties:
			try:
				# Check if user has read permission on this specific party document

				has_perm = frappe.has_permission(
					doctype=party_type,
					ptype="read",
					user=frappe.session.user,
					doc=frappe.get_doc(party_type, party.name)
				)
				if has_perm:
					allowed_parties.append({
						"name": party.name,
						"party_name": party.party_name,
						"default_currency": party.default_currency
					})
			except Exception as perm_error:
				# If there's an error checking permission for this specific party, skip it
				frappe.log_error(f"Permission check error for {party_type} {party.name}: {str(perm_error)}")
				continue

		return {
			"success": True,
			"parties": allowed_parties
		}

	except Exception as e:
		frappe.log_error(f"Get Permission Aware Parties Error: {str(e)}")
		# Fallback: return all parties if there's an error
		try:
			if party_type == "Customer":
				filters = {"is_internal_customer": 1, "disabled": 0}
				fields = ["name", "customer_name as party_name", "default_currency"]
			elif party_type == "Supplier":
				filters = {"is_internal_supplier": 1, "disabled": 0}
				fields = ["name", "supplier_name as party_name", "default_currency"]

			parties = frappe.get_all(
				party_type,
				fields=fields,
				filters=filters,
				order_by="name"
			)
			return {
				"success": True,
				"parties": [{"name": p.name, "party_name": p.party_name, "default_currency": p.default_currency} for p in parties]
			}
		except:
			return {
				"success": False,
				"error": str(e),
				"parties": []
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
		voucher_type = data.get("voucher_type")
		voucher_no = data.get("voucher_no")
		company = data.get("company")
		match_status = data.get("status")
		matched_with = data.get("matched_with")
		party = data.get("party")  # For Journal Entries
		party_type = data.get("party_type")  # For Journal Entries (Customer/Supplier)
		gl_entry = data.get("gl_entry")  # For Journal Entries - specific GL Entry (debit or credit)

		if not all([voucher_type, voucher_no, company, match_status]):
			frappe.throw("Missing required fields: voucher_type, voucher_no, company, status")

		# Check if document exists
		if not frappe.db.exists(voucher_type, voucher_no):
			frappe.throw(f"Document {voucher_type} {voucher_no} not found")

		# Get the current document
		current_doc = frappe.get_doc(voucher_type, voucher_no)

		# For Journal Entries, handle child table updates
		# Note: party and party_type are required for Journal Entries
		if voucher_type == "Journal Entry":
			if not party or not party_type:
				frappe.throw(f"For Journal Entry {voucher_no}, party and party_type are required. Received party={party}, party_type={party_type}")
		
		if voucher_type == "Journal Entry" and party and party_type:
			# If unmatching, also handle paired transaction unmatch for Journal Entries
			if match_status == "Mismatch" and (matched_with is None or matched_with == ""):
				# Find the child table row for this party to get the matched_with info
				child_table = current_doc.get("custom_intercompany_match_details", [])
				matching_child_row = None

				for row in child_table:
					if row.party == party and row.party_type == party_type:
						matching_child_row = row
						break

				# If we have a matched entry, also unmatch the paired Journal Entry
				if matching_child_row and matching_child_row.intercompany_matched_with:
					try:
						matched_data = frappe.parse_json(matching_child_row.intercompany_matched_with)
						if isinstance(matched_data, dict):
							paired_voucher_type = matched_data.get('voucher_type')
							paired_voucher_no = matched_data.get('voucher_no')
							paired_company = matched_data.get('company')

							# If paired transaction is also a Journal Entry, find and update its child table
							if paired_voucher_type and paired_voucher_no and frappe.db.exists(paired_voucher_type, paired_voucher_no):
								if paired_voucher_type == "Journal Entry":
									# Try to unmatch the paired Journal Entry with retry logic
									paired_unmatch_retries = 3
									paired_unmatch_retry_count = 0
									paired_unmatch_success = False

									while paired_unmatch_retry_count < paired_unmatch_retries and not paired_unmatch_success:
										try:
											# Load the paired Journal Entry (reload on retry to get latest version)
											if paired_unmatch_retry_count > 0:
												paired_doc.reload()
											else:
												paired_doc = frappe.get_doc(paired_voucher_type, paired_voucher_no)

											paired_child_table = paired_doc.get("custom_intercompany_match_details", [])

											# Find the child table row in the paired Journal Entry that matches back to this Journal Entry
											# The matched_with in the paired entry should point to this voucher
											paired_matching_row = None
											for paired_row in paired_child_table:
												if paired_row.intercompany_matched_with:
													try:
														paired_matched_data = frappe.parse_json(paired_row.intercompany_matched_with)
														if isinstance(paired_matched_data, dict):
															# Check if this paired row's matched_with points back to the current voucher
															if (paired_matched_data.get('voucher_type') == voucher_type and
																paired_matched_data.get('voucher_no') == voucher_no and
																paired_matched_data.get('company') == company):
																paired_matching_row = paired_row
																print(f"[update_match_status] Found paired child row to unmatch: Journal Entry {paired_voucher_no}, party={paired_row.party}, party_type={paired_row.party_type}")
																break
													except:
														continue

											# If we found the matching child row, unmatch it
											if paired_matching_row:
												# Check if it's already unmatched (might have been done by the other transaction)
												if paired_matching_row.intercompany_match_status == "Mismatch":
													print(f"[update_match_status] Paired Journal Entry {paired_voucher_no} child row already unmatched, skipping")
													paired_unmatch_success = True
													break

												paired_matching_row.intercompany_match_status = "Mismatch"
												paired_matching_row.intercompany_matched_with = None
												paired_matching_row.intercompany_matched_by = None
												paired_matching_row.intercompany_matched_on = None
												paired_doc.save(ignore_permissions=True)
												frappe.db.commit()
												print(f"[update_match_status] Successfully unmatched paired Journal Entry {paired_voucher_no} child row for party {paired_matching_row.party}")
												paired_unmatch_success = True
											else:
												# No matching row found - might already be unmatched or never had a match
												print(f"[update_match_status] No matching child row found in paired Journal Entry {paired_voucher_no} (may already be unmatched)")
												paired_unmatch_success = True  # Not an error, just nothing to do
												break

										except frappe.QueryDeadlockError as e:
											paired_unmatch_retry_count += 1
											print(f"[update_match_status] QueryDeadlockError when unmatching paired Journal Entry {paired_voucher_no} (attempt {paired_unmatch_retry_count}/{paired_unmatch_retries}): {str(e)}")
											if paired_unmatch_retry_count >= paired_unmatch_retries:
												print(f"[update_match_status] Max retries reached for paired unmatch, continuing with main unmatch")
												break
											import time
											time.sleep(0.1 * (2 ** paired_unmatch_retry_count))

										except frappe.DocumentLockedError as e:
											# Document is locked, likely being updated by the other transaction
											print(f"[update_match_status] Paired Journal Entry {paired_voucher_no} is locked (likely being updated by other transaction), continuing with main unmatch")
											paired_unmatch_success = True  # Not a critical error
											break

										except Exception as e:
											# Log but don't fail the main operation
											print(f"[update_match_status] Non-critical error unmatching paired Journal Entry {paired_voucher_no}: {str(e)}")
											frappe.logger().warning(f"Error unmatching paired Journal Entry {paired_voucher_no} (non-critical): {str(e)}")
											paired_unmatch_success = True  # Don't retry for other errors, just continue
											break
								else:
									# For non-Journal Entry, use standard fields
									frappe.db.set_value(
										paired_voucher_type,
										paired_voucher_no,
										{
											'intercompany_match_status': 'Mismatch',
											'intercompany_matched_with': None,
											'intercompany_matched_by': None,
											'intercompany_matched_on': None
										}
									)
					except Exception as e:
						# Log but don't fail the main operation - paired unmatch is best effort
						# The paired entry might already be unmatched by the other transaction
						frappe.logger().warning(f"Non-critical error handling paired unmatch for Journal Entry {voucher_no}: {str(e)}")
						print(f"[update_match_status] Non-critical error handling paired unmatch (main unmatch will continue): {str(e)}")
						# Don't log as error since this is expected in concurrent scenarios

			# Ensure matched_with includes company information
			if matched_with and isinstance(matched_with, dict):
				if "company" not in matched_with:
					matched_with["company"] = company

			# Find or create child table row for this party and gl_entry
			# For Journal Entries, we need to differentiate between debit and credit GL entries
			child_table = current_doc.get("custom_intercompany_match_details", [])
			matching_child_row = None

			for row in child_table:
				# Match by party, party_type, and gl_entry (if provided)
				party_match = row.party == party and row.party_type == party_type
				gl_entry_match = True
				if gl_entry:
					# If gl_entry is provided, it must match
					gl_entry_match = row.gl_entry == gl_entry
				else:
					# If gl_entry is not provided, only match rows without gl_entry (backward compatibility)
					gl_entry_match = not row.gl_entry
				
				if party_match and gl_entry_match:
					matching_child_row = row
					break

			# Prepare matched_with value (include company if not present)
			matched_with_value = matched_with
			if isinstance(matched_with, dict):
				if "company" not in matched_with:
					matched_with["company"] = company
			if isinstance(matched_with, (dict, list)):
				matched_with_value = frappe.as_json(matched_with)

			# Set matched_by and matched_on
			matched_by_value = frappe.session.user if match_status == "Match" else None
			matched_on_value = frappe.utils.now() if match_status == "Match" else None

			if matching_child_row:
				# Update existing child table row
				matching_child_row.intercompany_match_status = match_status
				matching_child_row.intercompany_matched_with = matched_with_value if match_status == "Match" else None
				matching_child_row.intercompany_matched_by = matched_by_value
				matching_child_row.intercompany_matched_on = matched_on_value
				# Update gl_entry if provided (in case it wasn't set before)
				if gl_entry:
					matching_child_row.gl_entry = gl_entry
			else:
				# Create new child table row
				child_row_data = {
					"party_type": party_type,
					"party": party,
					"intercompany_match_status": match_status,
					"intercompany_matched_with": matched_with_value if match_status == "Match" else None,
					"intercompany_matched_by": matched_by_value,
					"intercompany_matched_on": matched_on_value
				}
				# Add gl_entry if provided
				if gl_entry:
					child_row_data["gl_entry"] = gl_entry
				current_doc.append("custom_intercompany_match_details", child_row_data)

			# Save the document with retry logic for concurrency issues
			max_retries = 3
			retry_count = 0
			main_operation_success = False

			while retry_count < max_retries:
				try:
					# Reload the document to get latest version (important for concurrent updates)
					if retry_count > 0:
						current_doc.reload()
						# Re-find the child table row after reload
						child_table = current_doc.get("custom_intercompany_match_details", [])
						matching_child_row = None

						for row in child_table:
							# Match by party, party_type, and gl_entry (if provided)
							party_match = row.party == party and row.party_type == party_type
							gl_entry_match = True
							if gl_entry:
								gl_entry_match = row.gl_entry == gl_entry
							else:
								gl_entry_match = not row.gl_entry
							
							if party_match and gl_entry_match:
								matching_child_row = row
								break

						# Update or create the row
						if matching_child_row:
							matching_child_row.intercompany_match_status = match_status
							matching_child_row.intercompany_matched_with = matched_with_value if match_status == "Match" else None
							matching_child_row.intercompany_matched_by = matched_by_value
							matching_child_row.intercompany_matched_on = matched_on_value
							# Update gl_entry if provided
							if gl_entry:
								matching_child_row.gl_entry = gl_entry
						else:
							child_row_data = {
								"party_type": party_type,
								"party": party,
								"intercompany_match_status": match_status,
								"intercompany_matched_with": matched_with_value if match_status == "Match" else None,
								"intercompany_matched_by": matched_by_value,
								"intercompany_matched_on": matched_on_value
							}
							# Add gl_entry if provided
							if gl_entry:
								child_row_data["gl_entry"] = gl_entry
							current_doc.append("custom_intercompany_match_details", child_row_data)

					print(f"[update_match_status] Saving Journal Entry {voucher_no} with party {party} (attempt {retry_count + 1})")
					current_doc.save(ignore_permissions=True)
					frappe.db.commit()

					frappe.logger().info(f"Successfully updated Journal Entry {voucher_no} child table for party {party}")
					print(f"[update_match_status] Successfully saved Journal Entry {voucher_no} for party {party}")

					main_operation_success = True
					break  # Exit retry loop on success

				except frappe.QueryDeadlockError as e:
					retry_count += 1
					print(f"[update_match_status] QueryDeadlockError for Journal Entry {voucher_no} (attempt {retry_count}/{max_retries}): {str(e)}")
					if retry_count >= max_retries:
						frappe.logger().error(f"Max retries reached for Journal Entry {voucher_no} child table update: {str(e)}")
						raise e
					# Wait a bit before retrying (exponential backoff)
					import time
					time.sleep(0.1 * (2 ** retry_count))

				except Exception as e:
					retry_count += 1
					if retry_count >= max_retries:
						frappe.logger().error(f"Max retries reached for Journal Entry {voucher_no} child table update: {str(e)}")
						frappe.log_error(f"Journal Entry child table update error for {voucher_no} party {party}: {str(e)}")
						print(f"[update_match_status] Error updating Journal Entry {voucher_no} for party {party}: {str(e)}")
						print(f"[update_match_status] Error type: {type(e).__name__}")
						print(f"[update_match_status] Error traceback: {frappe.get_traceback()}")
						raise e
					# Wait before retrying
					import time
					time.sleep(0.1 * (2 ** retry_count))

			# If main operation succeeded, return success (paired unmatch failures are non-critical)
			if main_operation_success:
				return {
					"success": True,
					"message": f"Match status updated to {match_status} for party {party}",
					"doc_name": voucher_no
				}
			else:
				# Main operation failed after all retries
				raise Exception(f"Failed to update Journal Entry {voucher_no} after {max_retries} retries")

		# For non-Journal Entry documents, use standard fields
		current_matched_with = current_doc.get("intercompany_matched_with")

		# If unmatching (status is Mismatch and matched_with is None), also unmatch the paired transaction
		if match_status == "Mismatch" and (matched_with is None or matched_with == ""):
			# Parse the current matched_with to find the paired transaction
			if current_matched_with:
				try:
					# Try to parse as JSON
					try:
						matched_data = frappe.parse_json(current_matched_with)
					except:
						matched_data = current_matched_with

					# Handle both single match (dict) and multiple matches (list)
					matches_to_unmatch = []
					if isinstance(matched_data, dict):
						matches_to_unmatch = [matched_data]
					elif isinstance(matched_data, list):
						matches_to_unmatch = matched_data

					# Unmatch each paired transaction
					for match in matches_to_unmatch:
						if not isinstance(match, dict):
							continue

						paired_voucher_type = match.get('voucher_type')
						paired_voucher_no = match.get('voucher_no')

						if paired_voucher_type and paired_voucher_no:
							# Check if the paired document exists
							if frappe.db.exists(paired_voucher_type, paired_voucher_no):
								# Update the paired document to Mismatch and clear all matching fields
								try:
									frappe.db.set_value(
										paired_voucher_type,
										paired_voucher_no,
										{
											'intercompany_match_status': 'Mismatch',
											'intercompany_matched_with': None,
											'intercompany_matched_by': None,
											'intercompany_matched_on': None
										}
									)
									frappe.logger().info(f"Also unmatched paired transaction {paired_voucher_type} {paired_voucher_no}")
								except Exception as e:
									frappe.logger().error(f"Error unmatching paired transaction {paired_voucher_type} {paired_voucher_no}: {str(e)}")
									# Continue even if paired unmatch fails
				except Exception as e:
					frappe.logger().error(f"Error parsing matched_with for unmatch: {str(e)}")
					# Continue with the main unmatch even if parsing fails

		# Ensure matched_with includes company information
		if matched_with and isinstance(matched_with, dict):
			if "company" not in matched_with:
				matched_with["company"] = company

		# Ensure matched_with includes company information
		if matched_with and isinstance(matched_with, dict):
			if "company" not in matched_with:
				matched_with["company"] = company

		matched_with_value = matched_with
		if isinstance(matched_with, (dict, list)):
			matched_with_value = frappe.as_json(matched_with)

		# Set matched_by and matched_on to None when unmatching
		matched_by_value = frappe.session.user if match_status == "Match" else None
		matched_on_value = frappe.utils.now() if match_status == "Match" else None

		update_data = {
			"intercompany_match_status": match_status,
			"intercompany_matched_with": matched_with_value,
			"intercompany_matched_by": matched_by_value,
			"intercompany_matched_on": matched_on_value
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
def get_match_status(voucher_type, voucher_no, company, party=None, party_type=None, gl_entry=None):
	"""Get current match status for a voucher from the original document
	For Journal Entries, checks the child table 'InterCompany Journal Match Detail' for the specific party and gl_entry
	"""
	try:
		try:
			doc = frappe.get_doc(voucher_type, voucher_no)

			# For Journal Entries, check the child table for the specific party and gl_entry
			if voucher_type == "Journal Entry" and party and party_type:
				# Look for child table entry matching the party and gl_entry
				child_table = doc.get("custom_intercompany_match_details", [])
				matching_child_row = None
				print(f"[get_match_status] Journal Entry {voucher_no}: Looking for party={party}, party_type={party_type}, gl_entry={gl_entry}")
				print(f"[get_match_status] Found {len(child_table)} child table rows")
				if gl_entry:
					print(f"[get_match_status] Searching for gl_entry: {gl_entry}")

				for row in child_table:
					# Match by party and party_type first
					party_match = row.party == party and row.party_type == party_type
					
					if not party_match:
						continue
					
					print(f"[get_match_status] Found matching party row: party={row.party}, party_type={row.party_type}, gl_entry={row.gl_entry}, status={row.intercompany_match_status}")
					
					# If gl_entry is provided, try to match by gl_entry
					if gl_entry:
						# First try exact match with gl_entry
						if row.gl_entry == gl_entry:
							matching_child_row = row
							print(f"[get_match_status] Exact gl_entry match found: {gl_entry}")
							break
						# If no gl_entry in row (backward compatibility - old matches), 
						# and this is the only row for this party, use it
						# This handles cases where matches were created before gl_entry was added
						elif not row.gl_entry:
							# Check if there are other rows for this party with gl_entry set
							# If not, this is likely the only match for this party, so use it
							has_other_rows_with_gl_entry = any(
								r.party == party and r.party_type == party_type and r.gl_entry 
								for r in child_table if r != row
							)
							if not has_other_rows_with_gl_entry:
								# This is the only row for this party, use it (backward compatibility)
								matching_child_row = row
								print(f"[get_match_status] Using row without gl_entry (backward compatibility): party={party}, party_type={party_type}")
								# Update the row to include gl_entry for future queries
								if not matching_child_row.gl_entry:
									matching_child_row.gl_entry = gl_entry
									try:
										doc.save(ignore_permissions=True)
										frappe.db.commit()
										print(f"[get_match_status] Updated row with gl_entry: {gl_entry}")
									except:
										pass  # Don't fail if update doesn't work
								break
						else:
							print(f"[get_match_status] gl_entry mismatch: row.gl_entry={row.gl_entry}, requested={gl_entry}")
					else:
						# If gl_entry is not provided, only match rows without gl_entry (backward compatibility)
						if not row.gl_entry:
							matching_child_row = row
							break

				if matching_child_row:
					# Found a child table entry for this party
					matched_with_raw = matching_child_row.get("intercompany_matched_with")
					matched_with_parsed = None

					# Try to parse the matched_with data if it exists
					if matched_with_raw:
						try:
							matched_with_parsed = frappe.parse_json(matched_with_raw)
						except:
							matched_with_parsed = matched_with_raw

					# Get the status from the child table - this is the source of truth
					# We should NOT override it based on company matching, because:
					# - The matched_with.company is the company of the MATCHED transaction
					# - The company parameter is the company of the CURRENT transaction
					# - These should be DIFFERENT for intercompany reconciliation!
					# - If they were the same, it wouldn't be an intercompany match
					status = matching_child_row.get("intercompany_match_status", "Pending")

					print(f"[get_match_status] Journal Entry {voucher_no} party={party} party_type={party_type} gl_entry={gl_entry}: Found matching row with status={status}, row.gl_entry={matching_child_row.get('gl_entry')}")

					return {
						"success": True,
						"status": status,
						"matched_with": matched_with_raw,
						"matched_with_parsed": matched_with_parsed,
						"matched_by": matching_child_row.get("intercompany_matched_by"),
						"matched_on": matching_child_row.get("intercompany_matched_on"),
						"from_child_table": True
					}
				else:
					# No child table entry for this party/gl_entry combination
					print(f"[get_match_status] Journal Entry {voucher_no}: No matching child table row found for party={party}, party_type={party_type}, gl_entry={gl_entry}")
					print(f"[get_match_status] Available rows: {[(r.party, r.party_type, r.gl_entry, r.intercompany_match_status) for r in child_table]}")
					return {
						"success": True,
						"status": "Mismatch",
						"matched_with": None,
						"matched_with_parsed": None,
						"matched_by": None,
						"matched_on": None,
						"from_child_table": True
					}

			# For non-Journal Entry or when party info not provided, use standard fields
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
				"matched_on": doc.get("intercompany_matched_on"),
				"from_child_table": False
			}
		except frappe.DoesNotExistError:
			return {
				"success": True,
				"status": "Pending",
				"matched_with": None,
				"matched_with_parsed": None,
				"matched_by": None,
				"matched_on": None,
				"from_child_table": False
			}

	except Exception as e:
		frappe.log_error(f"Get Match Status Error: {str(e)}")
		return {
			"success": False,
			"error": str(e),
			"message": "Failed to get match status"
		}


@frappe.whitelist()
def get_voucher_amount(voucher_type, voucher_no):
	"""Get the amount from a voucher document for intercompany reconciliation"""
	try:
		if not frappe.db.exists(voucher_type, voucher_no):
			return {
				"success": False,
				"error": f"Document {voucher_type} {voucher_no} not found"
			}

		doc = frappe.get_doc(voucher_type, voucher_no)

		# Get amount based on doctype
		amount = None
		debit = 0
		credit = 0

		if voucher_type == "Journal Entry":
			# For Journal Entry, sum up debit and credit from accounts
			total_debit = sum(entry.debit for entry in doc.accounts if entry.debit)
			total_credit = sum(entry.credit for entry in doc.accounts if entry.credit)
			debit = total_debit
			credit = total_credit
			# For intercompany, we typically use the larger of the two
			amount = max(total_debit, total_credit)

		elif voucher_type in ["Sales Invoice", "Purchase Invoice"]:
			# For invoices, use grand_total
			amount = doc.get("grand_total") or doc.get("total") or 0
			# Determine debit/credit based on invoice type
			if voucher_type == "Sales Invoice":
				credit = amount  # Sales Invoice creates credit entry
			else:
				debit = amount  # Purchase Invoice creates debit entry

		elif voucher_type in ["Payment Entry", "Bank Entry"]:
			# For Payment Entry, use paid_amount or total_allocated_amount
			amount = doc.get("paid_amount") or doc.get("total_allocated_amount") or doc.get("total_amount") or 0
			# Payment Entry can be either debit or credit depending on payment type
			if doc.get("payment_type") == "Pay":
				debit = amount
			else:
				credit = amount

		elif voucher_type == "Sales Order":
			amount = doc.get("grand_total") or doc.get("total") or 0
			credit = amount

		elif voucher_type == "Purchase Order":
			amount = doc.get("grand_total") or doc.get("total") or 0
			debit = amount

		else:
			# For other doctypes, try common amount fields
			amount = doc.get("grand_total") or doc.get("total") or doc.get("amount") or doc.get("total_amount") or 0

		return {
			"success": True,
			"amount": amount or 0,
			"debit": debit,
			"credit": credit,
			"currency": doc.get("currency") or doc.get("company_currency")
		}

	except Exception as e:
		frappe.log_error(f"Get Voucher Amount Error: {str(e)}")
		return {
			"success": False,
			"error": str(e),
			"message": f"Failed to get amount for {voucher_type} {voucher_no}"
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
def get_user_roles():
	"""Get current user's roles"""
	try:
		user_roles = frappe.get_roles()
		return {
			"success": True,
			"roles": user_roles
		}
	except Exception as e:
		frappe.log_error(f"Error fetching user roles: {str(e)}")
		return {
			"success": False,
			"error": str(e),
			"roles": []
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


def can_user_read_customer():
	"""Check if the given user has 'read' permission on the specified Customer."""
	doctype = "Customer"

	has_perm = frappe.has_permission(
		doctype=doctype,
		ptype="read",
		user="amiingeesle@gmail.com",
		doc=frappe.get_doc(doctype, "GL China Footwear")
	)

	return has_perm


def clear_intercompany_fields_before_submit(doc, method=None):
	"""
	Clear intercompany matching fields before submission.
	This prevents old intercompany match data from being carried over when cancelling and amending documents.

	Args:
		doc: The document being submitted
		method: The method name (for hook compatibility)
	"""
	try:
		# Check if the document has intercompany fields
		if not hasattr(doc, 'intercompany_match_status'):
			return

		# List of fields to clear if they have values
		fields_to_clear = [
			'intercompany_matched_by',
			'intercompany_matched_on',
			'intercompany_match_status',
			'intercompany_matched_with'
		]

		# Check each field and clear if it has a value
		fields_cleared = []
		for field in fields_to_clear:
			if hasattr(doc, field) and doc.get(field):
				# Set all fields to None
				doc.set(field, None)
				fields_cleared.append(field)

		if fields_cleared:
			frappe.logger().info(
				f"Cleared intercompany fields before submission for {doc.doctype} {doc.name}: {fields_cleared}"
			)

	except Exception as e:
		frappe.logger().error(
			f"Error clearing intercompany fields before submission for {doc.doctype} {doc.name}: {str(e)}"
		)
		# Don't raise the exception to prevent submission failure


def cleanup_intercompany_matches_on_cancel(doc, method=None):
	"""
	Clean up intercompany matches when a document is cancelled.
	This function checks if the document has intercompany matches and removes
	the corresponding matches from the matched documents.

	Args:
		doc: The document being cancelled
		method: The method name (for hook compatibility)
	"""
	try:
		if not hasattr(doc, 'intercompany_match_status') or not hasattr(doc, 'intercompany_matched_with'):
			return

		# Only proceed if the document was matched
		if doc.intercompany_match_status != 'Match' or not doc.intercompany_matched_with:
			return

		try:
			matched_data = frappe.parse_json(doc.intercompany_matched_with)
		except:
			matched_data = doc.intercompany_matched_with

		# Handle both single match and multiple matches
		matches_to_clean = []
		if isinstance(matched_data, dict):
			matches_to_clean = [matched_data]
		elif isinstance(matched_data, list):
			# Multiple matches
			matches_to_clean = matched_data

		# Clean up each matched document
		for match in matches_to_clean:
			if not isinstance(match, dict):
				continue

			voucher_type = match.get('voucher_type')
			voucher_no = match.get('voucher_no')

			if not voucher_type or not voucher_no:
				continue

			# Check if the matched document still exists
			if not frappe.db.exists(voucher_type, voucher_no):
				frappe.logger().info(f"Matched document {voucher_type} {voucher_no} no longer exists, skipping cleanup")
				continue

			try:
				# Get the matched document
				matched_doc = frappe.get_doc(voucher_type, voucher_no)
				# frappe.throw(str(matched_doc))
				# Check if this document also has matches
				if (hasattr(matched_doc, 'intercompany_match_status') and
					hasattr(matched_doc, 'intercompany_matched_with') and
					matched_doc.intercompany_match_status == 'Match' and
					matched_doc.intercompany_matched_with):

						# No more matches, reset to pending
					frappe.db.set_value(
						voucher_type,
						voucher_no,
						{
							'intercompany_match_status': 'Mismatch',
							'intercompany_matched_with': None,
							'intercompany_matched_by': None,
							'intercompany_matched_on': None
						}
					)

			except Exception as e:
				frappe.logger().error(f"Error cleaning up match for {voucher_type} {voucher_no}: {str(e)}")
				continue
	except Exception as e:
		frappe.logger().error(f"Error in cleanup_intercompany_matches_on_cancel for {doc.doctype} {doc.name}: {str(e)}")
		# Don't raise the exception to prevent cancellation failure


@frappe.whitelist()
def bulk_cleanup_cancelled_sales_invoices():
	"""
	Bulk cleanup function for cancelled Sales Invoices.
	Finds all cancelled Sales Invoices that have intercompany matches and cleans them up.
	"""
	try:
		# Find all cancelled Sales Invoices with intercompany matches
		cancelled_invoices = frappe.get_all(
			"Sales Invoice",
			filters={
				"docstatus": 2,  # Cancelled
				"intercompany_match_status": "Match",
				"intercompany_matched_with": ["!=", ""]
			},
			fields=["name", "intercompany_matched_with"]
		)

		processed_count = 0
		error_count = 0

		for invoice in cancelled_invoices:
			try:
				# Parse the matched_with data
				try:
					matched_data = frappe.parse_json(invoice.intercompany_matched_with)
				except:
					matched_data = invoice.intercompany_matched_with

				# Handle both single match and multiple matches
				matches_to_clean = []
				if isinstance(matched_data, dict):
					matches_to_clean = [matched_data]
				elif isinstance(matched_data, list):
					matches_to_clean = matched_data

				# Clean up each matched document
				for match in matches_to_clean:
					if not isinstance(match, dict):
						continue

					voucher_type = match.get('voucher_type')
					voucher_no = match.get('voucher_no')

					if not voucher_type or not voucher_no:
						continue

					# Check if the matched document still exists
					if frappe.db.exists(voucher_type, voucher_no):
						# Update the matched document to Mismatch status
						frappe.db.set_value(
							voucher_type,
							voucher_no,
							{
								'intercompany_match_status': 'Mismatch',
								'intercompany_matched_with': None,
								'intercompany_matched_by': None,
								'intercompany_matched_on': None
							}
						)

				processed_count += 1
				frappe.logger().info(f"Processed cancelled Sales Invoice: {invoice.name}")

			except Exception as e:
				error_count += 1
				frappe.logger().error(f"Error processing Sales Invoice {invoice.name}: {str(e)}")
				continue

		frappe.db.commit()

		return {
			"success": True,
			"message": f"Bulk cleanup completed for Sales Invoices",
			"total_found": len(cancelled_invoices),
			"processed": processed_count,
			"errors": error_count
		}

	except Exception as e:
		frappe.logger().error(f"Bulk cleanup Sales Invoices error: {str(e)}")
		return {
			"success": False,
			"error": str(e),
			"message": "Failed to perform bulk cleanup for Sales Invoices"
		}


@frappe.whitelist()
def bulk_cleanup_cancelled_purchase_invoices():
	"""
	Bulk cleanup function for cancelled Purchase Invoices.
	Finds all cancelled Purchase Invoices that have intercompany matches and cleans them up.
	"""
	try:
		# Find all cancelled Purchase Invoices with intercompany matches
		cancelled_invoices = frappe.get_all(
			"Purchase Invoice",
			filters={
				"docstatus": 2,  # Cancelled
				"intercompany_match_status": "Match",
				"intercompany_matched_with": ["!=", ""]
			},
			fields=["name", "intercompany_matched_with"]
		)

		processed_count = 0
		error_count = 0

		for invoice in cancelled_invoices:
			try:
				# Parse the matched_with data
				try:
					matched_data = frappe.parse_json(invoice.intercompany_matched_with)
				except:
					matched_data = invoice.intercompany_matched_with

				# Handle both single match and multiple matches
				matches_to_clean = []
				if isinstance(matched_data, dict):
					matches_to_clean = [matched_data]
				elif isinstance(matched_data, list):
					matches_to_clean = matched_data

				# Clean up each matched document
				for match in matches_to_clean:
					if not isinstance(match, dict):
						continue

					voucher_type = match.get('voucher_type')
					voucher_no = match.get('voucher_no')

					if not voucher_type or not voucher_no:
						continue

					# Check if the matched document still exists
					if frappe.db.exists(voucher_type, voucher_no):
						# Update the matched document to Mismatch status
						frappe.db.set_value(
							voucher_type,
							voucher_no,
							{
								'intercompany_match_status': 'Mismatch',
								'intercompany_matched_with': None,
								'intercompany_matched_by': None,
								'intercompany_matched_on': None
							}
						)

				processed_count += 1
				frappe.logger().info(f"Processed cancelled Purchase Invoice: {invoice.name}")

			except Exception as e:
				error_count += 1
				frappe.logger().error(f"Error processing Purchase Invoice {invoice.name}: {str(e)}")
				continue

		frappe.db.commit()

		return {
			"success": True,
			"message": f"Bulk cleanup completed for Purchase Invoices",
			"total_found": len(cancelled_invoices),
			"processed": processed_count,
			"errors": error_count
		}

	except Exception as e:
		frappe.logger().error(f"Bulk cleanup Purchase Invoices error: {str(e)}")
		return {
			"success": False,
			"error": str(e),
			"message": "Failed to perform bulk cleanup for Purchase Invoices"
		}


@frappe.whitelist()
def bulk_cleanup_cancelled_journal_entries():
	"""
	Bulk cleanup function for cancelled Journal Entries.
	Finds all cancelled Journal Entries that have intercompany matches and cleans them up.
	"""
	try:
		# Find all cancelled Journal Entries with intercompany matches
		cancelled_entries = frappe.get_all(
			"Journal Entry",
			filters={
				"docstatus": 2,  # Cancelled
				"intercompany_match_status": "Match",
				"intercompany_matched_with": ["!=", ""]
			},
			fields=["name", "intercompany_matched_with"]
		)

		processed_count = 0
		error_count = 0

		for entry in cancelled_entries:
			try:
				# Parse the matched_with data
				try:
					matched_data = frappe.parse_json(entry.intercompany_matched_with)
				except:
					matched_data = entry.intercompany_matched_with

				# Handle both single match and multiple matches
				matches_to_clean = []
				if isinstance(matched_data, dict):
					matches_to_clean = [matched_data]
				elif isinstance(matched_data, list):
					matches_to_clean = matched_data

				# Clean up each matched document
				for match in matches_to_clean:
					if not isinstance(match, dict):
						continue

					voucher_type = match.get('voucher_type')
					voucher_no = match.get('voucher_no')

					if not voucher_type or not voucher_no:
						continue

					# Check if the matched document still exists
					if frappe.db.exists(voucher_type, voucher_no):
						# Update the matched document to Mismatch status
						frappe.db.set_value(
							voucher_type,
							voucher_no,
							{
								'intercompany_match_status': 'Mismatch',
								'intercompany_matched_with': None,
								'intercompany_matched_by': None,
								'intercompany_matched_on': None
							}
						)

				processed_count += 1
				frappe.logger().info(f"Processed cancelled Journal Entry: {entry.name}")

			except Exception as e:
				error_count += 1
				frappe.logger().error(f"Error processing Journal Entry {entry.name}: {str(e)}")
				continue

		frappe.db.commit()

		return {
			"success": True,
			"message": f"Bulk cleanup completed for Journal Entries",
			"total_found": len(cancelled_entries),
			"processed": processed_count,
			"errors": error_count
		}

	except Exception as e:
		frappe.logger().error(f"Bulk cleanup Journal Entries error: {str(e)}")
		return {
			"success": False,
			"error": str(e),
			"message": "Failed to perform bulk cleanup for Journal Entries"
		}


@frappe.whitelist()
def bulk_cleanup_cancelled_payment_entries():
	"""
	Bulk cleanup function for cancelled Payment Entries.
	Finds all cancelled Payment Entries that have intercompany matches and cleans them up.
	"""
	try:
		# Find all cancelled Payment Entries with intercompany matches
		cancelled_entries = frappe.get_all(
			"Payment Entry",
			filters={
				"docstatus": 2,  # Cancelled
				"intercompany_match_status": "Match",
				"intercompany_matched_with": ["!=", ""]
			},
			fields=["name", "intercompany_matched_with"]
		)

		processed_count = 0
		error_count = 0

		for entry in cancelled_entries:
			try:
				# Parse the matched_with data
				try:
					matched_data = frappe.parse_json(entry.intercompany_matched_with)
				except:
					matched_data = entry.intercompany_matched_with

				# Handle both single match and multiple matches
				matches_to_clean = []
				if isinstance(matched_data, dict):
					matches_to_clean = [matched_data]
				elif isinstance(matched_data, list):
					matches_to_clean = matched_data

				# Clean up each matched document
				for match in matches_to_clean:
					if not isinstance(match, dict):
						continue

					voucher_type = match.get('voucher_type')
					voucher_no = match.get('voucher_no')

					if not voucher_type or not voucher_no:
						continue

					# Check if the matched document still exists
					if frappe.db.exists(voucher_type, voucher_no):
						# Update the matched document to Mismatch status
						frappe.db.set_value(
							voucher_type,
							voucher_no,
							{
								'intercompany_match_status': 'Mismatch',
								'intercompany_matched_with': None,
								'intercompany_matched_by': None,
								'intercompany_matched_on': None
							}
						)

				processed_count += 1
				frappe.logger().info(f"Processed cancelled Payment Entry: {entry.name}")

			except Exception as e:
				error_count += 1
				frappe.logger().error(f"Error processing Payment Entry {entry.name}: {str(e)}")
				continue

		frappe.db.commit()

		return {
			"success": True,
			"message": f"Bulk cleanup completed for Payment Entries",
			"total_found": len(cancelled_entries),
			"processed": processed_count,
			"errors": error_count
		}

	except Exception as e:
		frappe.logger().error(f"Bulk cleanup Payment Entries error: {str(e)}")
		return {
			"success": False,
			"error": str(e),
			"message": "Failed to perform bulk cleanup for Payment Entries"
		}


@frappe.whitelist()
def get_intercompany_matching_tolerance():
	"""
	Get the intercompany matching tolerance value from Inter Company Reconciliation Settings.
	Returns default value of 0.01 if settings don't exist or value is not set.
	"""
	try:
		if frappe.db.exists("Inter Company Reconciliation Settings", "Inter Company Reconciliation Settings"):
			tolerance = frappe.get_cached_value(
				"Inter Company Reconciliation Settings",
				"Inter Company Reconciliation Settings",
				"intercompany_matching_tolerance"
			)
			# Return tolerance if it exists and is a valid number, otherwise return default
			if tolerance is not None and tolerance >= 0:
				print("Tolerance fetched from settings:", tolerance)
				return {
					"success": True,
					"tolerance": float(tolerance)
				}
		
		# Default tolerance if settings don't exist or value is invalid
		return {
			"success": True,
			"tolerance": 0.01
		}
	except Exception as e:
		frappe.log_error(f"Error getting intercompany matching tolerance: {str(e)}")
		# Return default tolerance on error
		return {
			"success": True,
			"tolerance": 0.01
		}


@frappe.whitelist()
def clear_gl_cache(companyA=None, companyB=None, fromDate=None, toDate=None, partyA=None, partyB=None):
	"""
	Clear General Ledger cache for intercompany reconciliation.
	Clears cache entries matching the provided filters or all GL cache if no filters provided.
	"""
	try:
		cache = frappe.cache()

		# If specific filters are provided, clear matching cache keys
		if companyA or companyB or fromDate or toDate or partyA or partyB:
			# Clear cache for Company A
			if companyA and fromDate and toDate:
				if partyA:
					cache_key_a = f"gl_data_{companyA}_{fromDate}_{toDate}_{partyA}_0"
					cache.delete_value(cache_key_a)
					cache_key_a_with_opening = f"gl_data_{companyA}_{fromDate}_{toDate}_{partyA}_1"
					cache.delete_value(cache_key_a_with_opening)
				else:
					# Clear all cache keys for this company and date range
					# Note: This is a best-effort approach since we can't list all cache keys
					# In practice, cache keys are auto-expired after 5 minutes anyway
					pass

			# Clear cache for Company B
			if companyB and fromDate and toDate:
				if partyB:
					cache_key_b = f"gl_data_{companyB}_{fromDate}_{toDate}_{partyB}_0"
					cache.delete_value(cache_key_b)
					cache_key_b_with_opening = f"gl_data_{companyB}_{fromDate}_{toDate}_{partyB}_1"
					cache.delete_value(cache_key_b_with_opening)
		else:
			# If no filters provided, we can't easily clear all GL cache
			# Cache keys are auto-expired after 5 minutes anyway
			# This is mainly for frontend state clearing
			pass

		return {
			"success": True,
			"message": "Cache cleared successfully"
		}
	except Exception as e:
		frappe.log_error(f"Error clearing GL cache: {str(e)}")
		return {
			"success": False,
			"error": str(e),
			"message": "Failed to clear cache"
		}
