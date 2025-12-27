import frappe
from frappe.utils import flt


@frappe.whitelist()
def get_balance(company=None):
    """
    Returns total cash balance for a company using Frappe ORM only.
    """
    if not company:
        company = frappe.defaults.get_user_default("Company") or frappe.get_system_settings("default_company")

    # Get all Cash accounts for the company (non-group)
    cash_accounts = frappe.get_all(
        "Account",
        filters={
            "account_type": "Cash",
            "company": company,
            "is_group": 0
        },
        fields=["name"]
    )

    total_balance = 0.0

    for acc in cash_accounts:
        # Use Frappe ORM to sum debit and credit from GL Entries
        gl_entries = frappe.get_all(
            "GL Entry",
            filters={"account": acc.name, "company": company},
            fields=["debit", "credit"]
        )
        for entry in gl_entries:
            total_balance += flt(entry.debit) - flt(entry.credit)

    return {
        "value": total_balance,
        "fieldtype": "Currency"
    }
