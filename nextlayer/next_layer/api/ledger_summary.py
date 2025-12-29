import frappe
from frappe import _
from frappe.utils import flt, getdate, today
from typing import Dict, List, Optional, Tuple
import json

# Import the report extensions
from nextlayer.next_layer.report.customer_ledger_summary_extension.customer_ledger_summary_extension import execute as customer_ledger_execute
from nextlayer.next_layer.report.supplier_ledger_summary_extension.supplier_ledger_summary_extension import execute as supplier_ledger_execute


def get_representative_party_currency(company: str, party_type: str = "Customer", party_names: List[str] = None) -> str:
    """
    Get the currency from the first customer/supplier in the provided list.
    If not found, fall back to company currency.

    Args:
        company: Company name
        party_type: "Customer" or "Supplier"
        party_names: List of party names to check (optional)

    Returns:
        Currency code (e.g., "USD", "EUR", etc.)
    """
    try:
        # Get company currency as fallback
        company_currency = frappe.get_cached_value("Company", company, "default_currency") or "USD"

        # If party names are provided, check the first one
        if party_names and len(party_names) > 0:
            first_party_name = party_names[0]
            try:
                if party_type == "Customer":
                    party_currency = frappe.get_cached_value("Customer", first_party_name, "default_currency")
                else:  # Supplier
                    party_currency = frappe.get_cached_value("Supplier", first_party_name, "default_currency")

                if party_currency:
                    print(f"Found {party_type} currency for {first_party_name}: {party_currency}")
                    return party_currency
                else:
                    print(f"No currency found for {first_party_name}, using company currency: {company_currency}")
                    return company_currency
            except Exception as e:
                print(f"Error getting currency for {first_party_name}: {str(e)}")
                return company_currency

        # Fallback: Get the first customer/supplier for this company
        if party_type == "Customer":
            # Get first customer
            first_party = frappe.db.sql("""
                SELECT name, default_currency
                FROM `tabCustomer`
                WHERE disabled = 0
                ORDER BY customer_name
                LIMIT 1
            """, as_dict=True)
        else:  # Supplier
            # Get first supplier
            first_party = frappe.db.sql("""
                SELECT name, default_currency
                FROM `tabSupplier`
                WHERE disabled = 0
                ORDER BY supplier_name
                LIMIT 1
            """, as_dict=True)

        if first_party and first_party[0].get("default_currency"):
            party_currency = first_party[0]["default_currency"]
            return party_currency
        else:
            return company_currency

    except Exception as e:
        # Fall back to company currency
        try:
            return frappe.get_cached_value("Company", company, "default_currency") or "USD"
        except:
            return "USD"


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
        print("Customer ledger summary - report data fetched", data)
        # Extract party names from the data for currency determination
        party_names = []
        for row in data:
            if isinstance(row, dict):
                party_name = row.get("party") or row.get("customer")
                if party_name and party_name not in party_names:
                    party_names.append(party_name)

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

        # Get representative party currency for display
        representative_currency = get_representative_party_currency(company, "Customer", party_names)
        print(f"Using representative currency for customers: {representative_currency}")

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
                    "currency": representative_currency
                }
                entries.append(entry)

                # Calculate totals
                totals["totalOpeningBalance"] += entry["opening_balance"]
                totals["totalInvoicedAmount"] += entry["invoiced_amount"]
                totals["totalPaidAmount"] += entry["paid_amount"]
                totals["totalDebit"] += entry["debit"]
                totals["totalCredit"] += entry["credit"]
                totals["totalClosingBalance"] += entry["closing_balance"]
        print("Customer ledger summary totals:", entries)
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

        # Extract party names from the data for currency determination
        party_names = []
        for row in data:
            if isinstance(row, dict):
                party_name = row.get("party") or row.get("supplier")
                if party_name and party_name not in party_names:
                    party_names.append(party_name)

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

        # Get representative party currency for display
        representative_currency = get_representative_party_currency(company, "Supplier", party_names)

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
                    "currency": representative_currency
                }
                entries.append(entry)

                # Calculate totals
                totals["totalOpeningBalance"] += entry["opening_balance"]
                totals["totalInvoicedAmount"] += entry["invoiced_amount"]
                totals["totalPaidAmount"] += entry["paid_amount"]
                totals["totalDebit"] += entry["debit"]
                totals["totalCredit"] += entry["credit"]
                totals["totalClosingBalance"] += entry["closing_balance"]
        print('Supplier ledger summary totals:', entries)
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


@frappe.whitelist()
def get_gl_closing_amounts(filters: Dict) -> Dict:

    try:
        company = filters.get("company")
        from_date = filters.get("from_date")
        to_date = filters.get("to_date")
        currency = filters.get("currency", "all")
        party_type = filters.get("party_type")
        parties = filters.get("parties", [])

        # Validate inputs
        if not all([company, from_date, to_date, party_type]):
            frappe.throw(_("Company, from_date, to_date, and party_type are required"))

        if not parties:
            return {
                "success": True,
                "gl_closing_amounts": {},
                "message": "No parties provided"
            }

        # Import the general ledger report execution function
        from nextlayer.next_layer.report.general_ledger_extension.general_ledger_extension import execute

        gl_closing_amounts = {}

        # Process each party individually for better debugging and reliability
        for party in parties:
            try:
                # Correct logic: line party becomes company, filter company becomes party
                gl_filters = {
                    "company": party,  # The line party (customer/supplier) becomes the company in GL
                    "from_date": from_date,
                    "to_date": to_date,
                    "party": [company],  # The filter company becomes the party in GL
                    "party_type": party_type,
                    "show_remarks": 1,
                    "categorize_by": "Categorize by Voucher (Consolidated)",
                    "include_dimensions": 1,
                    "include_default_book_entries": 1,
                }

                # Add currency filters - match general_ledger.py format
                if currency != "all":
                    gl_filters["presentation_currency"] = currency
                    gl_filters["account_currency"] = currency
                else:
                    # When using "all", resolve a safe company currency for the GL company (the party)
                    # Prefer the GL company (party) currency; fallback to selected company's currency; then to USD
                    party_company_currency = frappe.get_cached_value("Company", party, "default_currency") if party else None
                    selected_company_currency = frappe.get_cached_value("Company", company, "default_currency") if company else None
                    safe_company_currency = party_company_currency or selected_company_currency or "USD"

                    gl_filters["company_currency"] = safe_company_currency
                    gl_filters["account_currency"] = safe_company_currency

                gl_filters["company_fb"] = ""

                # Convert to _dict format like general_ledger.py
                from frappe import _dict
                gl_filters = _dict(gl_filters)

                # Run with elevated permissions to bypass all restrictions
                original_user = frappe.session.user
                try:
                    # frappe.set_user("Administrator")
                    columns, data = execute(gl_filters)

                finally:
                    frappe.set_user(original_user)

                # Extract closing balance from the GL data
                closing_balance = 0

                # First pass: find all "Closing (Opening + Total)" rows
                closing_rows = []
                for i, row in enumerate(data):
                    try:
                        if isinstance(row, dict):
                            account_name = row.get("account", "")
                            balance = flt(row.get("balance", 0))

                            if "Closing (Opening + Total)" in account_name:
                                closing_rows.append((i, balance))
                    except Exception as row_error:
                        continue

                # Take the LAST closing row (final balance)
                if closing_rows:
                    last_row_index, last_balance = closing_rows[-1]
                    closing_balance = last_balance
                else:
                    closing_balance = 0

                gl_closing_amounts[party] = closing_balance

            except Exception as e:
                import traceback
                gl_closing_amounts[party] = 0


        # Show which parties have non-zero balances
        non_zero_parties = {k: v for k, v in gl_closing_amounts.items() if v != 0}

        return {
            "success": True,
            "gl_closing_amounts": gl_closing_amounts
        }

    except Exception as e:
        frappe.log_error(f"GL Closing Amounts Error: {str(e)}")
        return {
            "success": False,
            "error": str(e),
            "message": _("Failed to fetch GL closing amounts")
        }


@frappe.whitelist()
def get_intransit_invoice_totals(filters: Dict) -> Dict:
    """
    Get total of in-transit invoices (invoices where custom_actual_arrival_date is None)
    for given parties and company.

    Args:
        filters: Dict containing:
            - company: Company name
            - party_type: "Customer" or "Supplier"
            - parties: List of party names
            - from_date: Start date (optional)
            - to_date: End date (optional)

    Returns:
        Dict with party names as keys and in-transit totals as values
    """
    try:
        company = filters.get("company")
        party_type = filters.get("party_type")
        parties = filters.get("parties", [])
        from_date = filters.get("from_date")
        to_date = filters.get("to_date")

        if not all([company, party_type]):
            frappe.throw(_("Company and party_type are required"))

        if not parties:
            return {
                "success": True,
                "intransit_totals": {},
                "message": "No parties provided"
            }

        # Determine which doctype and fields to use
        if party_type == "Supplier":
            # For Supplier side: Check Sales Invoices
            # The party (supplier company) is the company on the invoice
            # The company selected at top is the customer on the invoice
            invoice_type = "Sales Invoice"
            party_field = "company"  # The party becomes the company on the invoice
            company_field = "customer"  # The top company becomes the customer
        else:  # Customer
            # For Customer side: Check Purchase Invoices
            # The party (customer company) is the company on the invoice
            # The company selected at top is the supplier on the invoice
            invoice_type = "Purchase Invoice"
            party_field = "company"  # The party becomes the company on the invoice
            company_field = "supplier"  # The top company becomes the supplier

        intransit_totals = {}

        for party in parties:
            try:
                # Build filters for invoices
                # The party becomes the company on the invoice
                # The top company becomes the customer/supplier on the invoice
                invoice_filters = {
                    party_field: party,  # Party is the company on the invoice
                    company_field: company,  # Top company is customer/supplier on the invoice
                    "docstatus": 1,  # Only submitted invoices
                    "custom_actual_arrival_date": ["in", [None, ""]]  # In-transit (date is None/empty)
                }
                # Add date filters if provided
                if from_date:
                    invoice_filters["posting_date"] = [">=", from_date]
                if to_date:
                    if "posting_date" in invoice_filters:
                        invoice_filters["posting_date"] = [invoice_filters["posting_date"], "<=", to_date]
                    else:
                        invoice_filters["posting_date"] = ["<=", to_date]

                # Get all invoices first, then filter for None custom_actual_arrival_date
                # Frappe filters don't handle None well, so we get all and filter in Python
                base_filters = {
                    party_field: party,  # Party is the company on the invoice
                    company_field: company,  # Top company is customer/supplier on the invoice
                    "docstatus": 1
                }
                
                # Properly construct date filters for Frappe
                if from_date and to_date:
                    base_filters["posting_date"] = ["between", [from_date, to_date]]
                elif from_date:
                    base_filters["posting_date"] = [">=", from_date]
                elif to_date:
                    base_filters["posting_date"] = ["<=", to_date]
                
                # Get invoices matching the base filters
                all_invoices = frappe.get_all(
                    invoice_type,
                    filters=base_filters,
                    fields=["name", "grand_total", "currency", "base_grand_total", "custom_actual_arrival_date"]
                )
                
                # Filter for in-transit invoices (custom_actual_arrival_date is None or empty)
                invoices = [
                    inv for inv in all_invoices 
                    if not inv.get("custom_actual_arrival_date") or inv.get("custom_actual_arrival_date") == ""
                ]

                # Calculate total in company currency (base_grand_total)
                total_intransit = sum(flt(inv.get("grand_total", 0)) for inv in invoices)

                intransit_totals[party] = total_intransit
                print("In-transit total for party", party, ":", total_intransit, "invoices found:", invoices)
            except Exception as e:
                print(f"Error processing party {party} for in-transit invoices: {str(e)}")
                intransit_totals[party] = 0

        return {
            "success": True,
            "intransit_totals": intransit_totals
        }

    except Exception as e:
        frappe.log_error(f"In-Transit Invoice Totals Error: {str(e)}")
        return {
            "success": False,
            "error": str(e),
            "message": _("Failed to fetch in-transit invoice totals"),
            "intransit_totals": {}
        }
