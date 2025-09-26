import frappe
from frappe import _
from frappe.utils import flt, getdate, today
from typing import Dict, List, Optional, Tuple
import json

# Import the report extensions
from nextlayer.next_layer.report.customer_ledger_summary_extension.customer_ledger_summary_extension import execute as customer_ledger_execute
from nextlayer.next_layer.report.supplier_ledger_summary_extension.supplier_ledger_summary_extension import execute as supplier_ledger_execute


@frappe.whitelist()
def get_customer_ledger_summary(filters: Dict) -> Dict:
    """
    Get customer ledger summary for intercompany reconciliation using report extension

    Args:
        filters: Dict containing company, from_date, to_date, currency, show_intercompany_only

    Returns:
        Dict containing ledger summary data
    """
    try:
        print("Customer ledger summary - received filters:", filters)
        # Extract parameters from filters
        company = filters.get("company")
        from_date = filters.get("from_date")
        to_date = filters.get("to_date")
        currency = filters.get("currency", "all")
        show_intercompany_only = filters.get("show_intercompany_only", True)
        print("Customer ledger summary - extracted params:", {
            "company": company, "from_date": from_date, "to_date": to_date,
            "currency": currency, "show_intercompany_only": show_intercompany_only
        })

        # Validate inputs
        if not all([company, from_date, to_date]):
            frappe.throw(_("Company, from_date, and to_date are required"))

        # Convert string boolean to actual boolean
        if isinstance(show_intercompany_only, str):
            show_intercompany_only = show_intercompany_only.lower() == 'true'

        # Prepare filters for the report
        filters = {
            "company": company,
            "from_date": from_date,
            "to_date": to_date,
            "in_party_currency":filters.get("in_party_currency", 0),
            "ignore_cr_dr_notes":filters.get("ignore_system_generated_notes", 0),
            "ignore_err":filters.get("ignore_exchange_rate_revaluation", 0),
            # "currency": currency if currency != "all" else None
        }

        # Add intercompany filter if needed
        if show_intercompany_only:
            # Get intercompany customers
            intercompany_customers = frappe.get_all(
                "Customer",
                filters={"is_internal_customer": 1, "disabled": 0},
                fields=["name"]
            )
            if not intercompany_customers:
                return {
                    "entries": [],
                    "totals": {
                        "totalOpeningBalance": 0,
                        "totalInvoicedAmount": 0,
                        "totalPaidAmount": 0,
                        "totalDebit": 0,
                        "totalCredit": 0,
                        "totalClosingBalance": 0
                    },
                    "message": "No intercompany customers found"
                }
            # For now, we'll get all customers and filter later
            # In a real implementation, you might want to pass specific customer filters

        # Execute the customer ledger summary report
        columns, data = customer_ledger_execute(filters)
        print("Customer data:", data)
        # Process the report data
        entries = []
        totals = {
            "totalOpeningBalance": 0,
            "totalInvoicedAmount": 0,
            "totalPaidAmount": 0,
            "totalDebit": 0,
            "totalCredit": 0,
            "totalClosingBalance": 0
        }

        for row in data:
            if isinstance(row, dict):
                # Filter intercompany customers if needed
                if show_intercompany_only:
                    customer_name = row.get("party") or row.get("customer")
                    if customer_name:
                        customer_doc = frappe.get_doc("Customer", customer_name)
                        if not customer_doc.get("is_internal_customer", False):
                            continue

                entry = {
                    "party": row.get("party") or row.get("customer", ""),
                    "party_name": row.get("party_name") or row.get("customer_name", ""),
                    "company": company,
                    "opening_balance": flt(row.get("opening_balance", 0)),
                    "invoiced_amount": flt(row.get("invoiced_amount", 0)),
                    "paid_amount": flt(row.get("paid_amount", 0)),
                    "debit": flt(row.get("debit", 0)),
                    "credit": flt(row.get("credit", 0)),
                    "closing_balance": flt(row.get("closing_balance", 0)),
                    "currency": currency if currency != "all" else "USD"
                }
                entries.append(entry)

                # Calculate totals
                totals["totalOpeningBalance"] += entry["opening_balance"]
                totals["totalInvoicedAmount"] += entry["invoiced_amount"]
                totals["totalPaidAmount"] += entry["paid_amount"]
                totals["totalDebit"] += entry["debit"]
                totals["totalCredit"] += entry["credit"]
                totals["totalClosingBalance"] += entry["closing_balance"]

        return {
            "entries": entries,
            "totals": totals,
            "success": True
        }

    except Exception as e:
        frappe.log_error(f"Error in get_customer_ledger_summary: {str(e)}")
        return {
            "success": False,
            "error": str(e),
            "entries": [],
            "totals": {
                "totalOpeningBalance": 0,
                "totalInvoicedAmount": 0,
                "totalPaidAmount": 0,
                "totalDebit": 0,
                "totalCredit": 0,
                "totalClosingBalance": 0
            }
        }


@frappe.whitelist()
def get_supplier_ledger_summary(filters: Dict) -> Dict:
    """
    Get supplier ledger summary for intercompany reconciliation using report extension

    Args:
        filters: Dict containing company, from_date, to_date, currency, show_intercompany_only

    Returns:
        Dict containing ledger summary data
    """
    try:
        print("Supplier ledger summary - received filters:", filters)
        # Extract parameters from filters
        company = filters.get("company")
        from_date = filters.get("from_date")
        to_date = filters.get("to_date")
        currency = filters.get("currency", "all")
        show_intercompany_only = filters.get("show_intercompany_only", True)
        print("Supplier ledger summary - extracted params:", {
            "company": company, "from_date": from_date, "to_date": to_date,
            "currency": currency, "show_intercompany_only": show_intercompany_only
        })

        # Validate inputs
        if not all([company, from_date, to_date]):
            frappe.throw(_("Company, from_date, and to_date are required"))

        # Convert string boolean to actual boolean
        if isinstance(show_intercompany_only, str):
            show_intercompany_only = show_intercompany_only.lower() == 'true'

        # Prepare filters for the report
        report_filters = {
            "company": company,
            "from_date": from_date,
            "to_date": to_date,
            "currency": currency if currency != "all" else None,
            "in_party_currency":filters.get("in_party_currency", 0),
            "ignore_cr_dr_notes":filters.get("ignore_system_generated_notes", 0),
            "ignore_err":filters.get("ignore_exchange_rate_revaluation", 0),
        }

        # Add intercompany filter if needed
        if show_intercompany_only:
            # Get intercompany suppliers
            intercompany_suppliers = frappe.get_all(
                "Supplier",
                filters={"is_internal_supplier": 1, "disabled": 0},
                fields=["name"]
            )
            if not intercompany_suppliers:
                return {
                    "entries": [],
                    "totals": {
                        "totalOpeningBalance": 0,
                        "totalInvoicedAmount": 0,
                        "totalPaidAmount": 0,
                        "totalDebit": 0,
                        "totalCredit": 0,
                        "totalClosingBalance": 0
                    },
                    "message": "No intercompany suppliers found"
                }

        # Execute the supplier ledger summary report
        columns, data = supplier_ledger_execute(report_filters)
        print("Supplier data:", data)
        # Process the report data
        entries = []
        totals = {
            "totalOpeningBalance": 0,
            "totalInvoicedAmount": 0,
            "totalPaidAmount": 0,
            "totalDebit": 0,
            "totalCredit": 0,
            "totalClosingBalance": 0
        }

        for row in data:
            if isinstance(row, dict):
                # Filter intercompany suppliers if needed
                if show_intercompany_only:
                    supplier_name = row.get("party") or row.get("supplier")
                    if supplier_name:
                        supplier_doc = frappe.get_doc("Supplier", supplier_name)
                        if not supplier_doc.get("is_internal_supplier", False):
                            continue

                entry = {
                    "party": row.get("party") or row.get("supplier", ""),
                    "party_name": row.get("party_name") or row.get("supplier_name", ""),
                    "company": company,
                    "opening_balance": flt(row.get("opening_balance", 0)),
                    "invoiced_amount": flt(row.get("invoiced_amount", 0)),
                    "paid_amount": flt(row.get("paid_amount", 0)),
                    "debit": flt(row.get("debit", 0)),
                    "credit": flt(row.get("credit", 0)),
                    "closing_balance": flt(row.get("closing_balance", 0)),
                    "currency": currency if currency != "all" else "USD"
                }
                entries.append(entry)

                # Calculate totals
                totals["totalOpeningBalance"] += entry["opening_balance"]
                totals["totalInvoicedAmount"] += entry["invoiced_amount"]
                totals["totalPaidAmount"] += entry["paid_amount"]
                totals["totalDebit"] += entry["debit"]
                totals["totalCredit"] += entry["credit"]
                totals["totalClosingBalance"] += entry["closing_balance"]

        return {
            "entries": entries,
            "totals": totals,
            "success": True
        }

    except Exception as e:
        frappe.log_error(f"Error in get_supplier_ledger_summary: {str(e)}")
        return {
            "success": False,
            "error": str(e),
            "entries": [],
            "totals": {
                "totalOpeningBalance": 0,
                "totalInvoicedAmount": 0,
                "totalPaidAmount": 0,
                "totalDebit": 0,
                "totalCredit": 0,
                "totalClosingBalance": 0
            }
        }




@frappe.whitelist()
def get_intercompany_parties(
    company: str,
    party_type: str = "Customer",
    currency: str = "all"
) -> Dict:
    """
    Get list of intercompany customers or suppliers

    Args:
        company: Company name
        party_type: "Customer" or "Supplier"
        currency: Currency filter

    Returns:
        List of intercompany parties
    """
    try:
        if party_type not in ["Customer", "Supplier"]:
            frappe.throw(_("Party type must be either 'Customer' or 'Supplier'"))

        # Use correct field based on party type
        if party_type == "Customer":
            conditions = ["is_internal_customer = 1", "disabled = 0"]
        else:  # Supplier
            conditions = ["is_internal_supplier = 1", "disabled = 0"]

        if currency != "all":
            conditions.append(f"default_currency = '{currency}'")

        where_clause = " AND ".join(conditions)

        parties = frappe.db.sql(f"""
            SELECT name,
                   {'customer_name' if party_type == 'Customer' else 'supplier_name'} as party_name,
                   default_currency
            FROM `tab{party_type}`
            WHERE {where_clause}
            ORDER BY {'customer_name' if party_type == 'Customer' else 'supplier_name'}
        """, as_dict=True)

        return {
            "success": True,
            "parties": parties or []
        }

    except Exception as e:
        frappe.log_error(f"Error getting intercompany parties: {str(e)}")
        return {
            "success": False,
            "error": str(e),
            "parties": []
        }
