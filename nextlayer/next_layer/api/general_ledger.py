
# api/general_ledger.py
import frappe
from frappe import _
from frappe.utils import cint, flt
# from nextlayer.next_layer.report.general_ledger.general_ledger import execute
from nextlayer.next_layer.report.general_ledger_extension.general_ledger_extension import execute
from frappe import _dict
import frappe
from frappe.utils import flt

@frappe.whitelist()
def get_general_ledger_data(filters):
    try:
        # Parse filters if they're passed as JSON string
        if isinstance(filters, str):
            filters = frappe.parse_json(filters)

        # Convert dict → frappe._dict so .party works
        filters = _dict(filters)

        # Validate required fields
        if not filters.get("company"):
            frappe.throw(_("Company is required"))

        if not filters.get("from_date") or not filters.get("to_date"):
            frappe.throw(_("From Date and To Date are required"))

        # Set default values
        # filters.setdefault("party_type", "Customer")
        filters.setdefault("show_remarks", 1)
        # filters.setdefault("include_dimensions", 1)
        # filters.setdefault("group_by", "Group by Account")
        filters.setdefault("categorize_by", "Categorize by Voucher (Consolidated)")
        filters.setdefault("include_dimensions", 1)
        filters.setdefault("include_default_book_entries", 1)
        filters.setdefault("company_currency", "INR")
        filters.setdefault("account_currency", "INR")
        filters.setdefault("company_fb", "")

        # Execute the report
        columns, data = execute(filters)
        # print("Print", data)
        # Format the response
        return {
            "success": True,
            "data": {
                "columns": columns,
                "entries": data,
                "filters_applied": filters,
                "total_entries": len(data),
            },
        }

    except Exception as e:
        frappe.log_error(f"General Ledger API Error: {str(e)}")
        return {
            "success": False,
            "error": str(e),
            "message": _("Failed to fetch General Ledger data"),
        }


@frappe.whitelist()
def get_companies():
    """Get list of companies for dropdown"""
    try:
        # Log the request for debugging
        frappe.logger().info(f"get_companies called by user: {frappe.session.user}")
        frappe.logger().info(f"Request method: {frappe.request.method}")
        frappe.logger().info(f"Request headers: {dict(frappe.request.headers)}")
        frappe.logger().info(f"Request args: {frappe.request.args}")
        frappe.logger().info(f"Request form: {frappe.request.form}")

        companies = frappe.get_all(
            "Company",
            fields=["name", "default_currency"],
            order_by="name"
        )

        frappe.logger().info(f"Found {len(companies)} companies")
        return {"success": True, "data": companies}

    except Exception as e:
        frappe.logger().error(f"Error in get_companies: {str(e)}")
        frappe.log_error(f"get_companies API Error: {str(e)}")
        return {
            "success": False,
            "error": str(e),
            "message": "Failed to fetch companies"
        }

@frappe.whitelist()
def get_parties(party_type="Customer", company=None):
    """Get list of parties (customers/suppliers) for dropdown"""
    try:
        # Log the request for debugging
        frappe.logger().info(f"get_parties called by user: {frappe.session.user}, party_type: {party_type}, company: {company}")

        filters = {}

        # company filter if needed
        # if company:
        #     filters["company"] = company

        # add internal customer/supplier filter
        if party_type == "Customer":
            filters["is_internal_customer"] = 1
            fields = ["name", "customer_name as party_name"]
        elif party_type == "Supplier":
            filters["is_internal_supplier"] = 1
            fields = ["name", "supplier_name as party_name"]
        else:
            frappe.throw("Invalid party_type. Must be 'Customer' or 'Supplier'")

        parties = frappe.get_all(
            party_type,
            fields=fields,
            filters=filters,
            order_by="name"
        )

        frappe.logger().info(f"Found {len(parties)} {party_type} parties")
        return {"success": True, "data": parties}

    except Exception as e:
        frappe.logger().error(f"Error in get_parties: {str(e)}")
        frappe.log_error(f"get_parties API Error: {str(e)}")
        return {
            "success": False,
            "error": str(e),
            "message": f"Failed to fetch {party_type} parties"
        }


@frappe.whitelist()
def update_match_status():
    """Update match status for GL entries by updating the original document"""
    try:
        # Get the raw data as bytes and decode to string
        raw_data = frappe.request.get_data()
        frappe.logger().info(f"Raw data type: {type(raw_data)}, Raw data: {raw_data}")
        data_string = raw_data.decode('utf-8')
        frappe.logger().info(f"Decoded string: {data_string}")
        data = frappe.parse_json(data_string)
        frappe.logger().info(f"Parsed data: {data}")

        # Validate that data is a dictionary
        if not isinstance(data, dict):
            frappe.throw(f"Expected dictionary data, got {type(data)}")

        voucher_type = data.get("voucher_type")
        voucher_no = data.get("voucher_no")
        company = data.get("company")
        match_status = data.get("status")
        matched_with = data.get("matched_with")

        frappe.logger().info(f"Extracted fields: voucher_type={voucher_type}, voucher_no={voucher_no}, company={company}, status={match_status}")
        frappe.logger().info(f"Matched with type: {type(matched_with)}, value: {matched_with}")

        if not all([voucher_type, voucher_no, company, match_status]):
            frappe.throw("Missing required fields: voucher_type, voucher_no, company, status")

        # Check if document exists
        if not frappe.db.exists(voucher_type, voucher_no):
            frappe.throw(f"Document {voucher_type} {voucher_no} not found")

        # Handle matched_with field - convert dict to JSON string if needed
        matched_with_value = matched_with
        if isinstance(matched_with, dict):
            matched_with_value = frappe.as_json(matched_with)

        # Use frappe.db.set_value to bypass submit validation
        frappe.logger().info(f"Updating {voucher_type} {voucher_no} with match_status={match_status}")

        frappe.db.set_value(
            voucher_type,
            voucher_no,
            "intercompany_match_status",
            match_status
        )

        frappe.db.set_value(
            voucher_type,
           voucher_no,
            "intercompany_matched_with",
            matched_with_value
        )

        frappe.db.set_value(
            voucher_type,
            voucher_no,
            "intercompany_matched_by",
            frappe.session.user
        )

        frappe.db.set_value(
            voucher_type,
            voucher_no,
            "intercompany_matched_on",
            frappe.utils.now()
        )

        frappe.db.commit()
        frappe.logger().info(f"Successfully updated {voucher_type} {voucher_no}")

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
            return {
                "success": True,
                "status": doc.get("intercompany_match_status", "Pending"),
                "matched_with": doc.get("intercompany_matched_with"),
                "matched_by": doc.get("intercompany_matched_by"),
                "matched_on": doc.get("intercompany_matched_on")
            }
        except frappe.DoesNotExistError:
            return {
                "success": True,
                "status": "Pending",
                "matched_with": None,
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


# api/helpers.py

@frappe.whitelist()
def test_endpoint():
    """Simple test endpoint to verify API is working"""
    try:
        return {
            "success": True,
            "message": "API is working",
            "user": frappe.session.user,
            "timestamp": frappe.utils.now()
        }
    except Exception as e:
        return {
            "success": False,
            "error": str(e)
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

        # Skip rows without posting_date (these are summary rows)
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
