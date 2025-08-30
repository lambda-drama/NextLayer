
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
