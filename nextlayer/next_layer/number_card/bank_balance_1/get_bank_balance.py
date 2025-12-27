import frappe
from frappe.utils import flt

@frappe.whitelist()
def get_balance(company=None):
    """
    Returns total bank balance for a company using Frappe ORM (no SQL).
    """
    if not company:
        company = frappe.defaults.get_user_default("Company") or frappe.get_system_settings("default_company")

    # Get all Bank accounts (non-group)
    bank_accounts = frappe.get_all(
        "Account",
        filters={
            "account_type": "Bank",
            "company": company,
            "is_group": 0
        },
        fields=["name"]
    )

    total_balance = 0.0

    for acc in bank_accounts:
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
