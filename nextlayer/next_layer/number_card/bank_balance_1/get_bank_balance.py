import frappe
from frappe.utils.data import flt
from erpnext.accounts.utils import get_balance_on

@frappe.whitelist()
def get_accounts_balance(company=None):
    """
    Returns list of bank accounts with balances for a company using Frappe ORM.
    Returns a list of dicts like:
    [
        {"Account": "Bank - ABC", "Balance": 12345.67},
        {"Account": "Bank - XYZ", "Balance": 890.12}
    ]
    """
    if not company:
        company = frappe.defaults.get_user_default("Company") or frappe.get_system_settings("default_company")

    # Get all Bank accounts (non-group) for the company
    bank_accounts = frappe.get_all(
        "Account",
        filters={"account_type": "Bank", "is_group": 0},
        fields=["name", "account_name"]
    )

    

    result = []
    for acc in bank_accounts:
        balance = get_balance_on(account=acc.name, company=company)
        # Only include accounts with non-zero balance
        if flt(balance) != 0:
            result.append({
                "Account": acc.name,
                "Balance": flt(balance)
            })

    # If no account has balance, return a single placeholder
    if not result:
        total_balance = sum([get_balance_on(account=acc.name, company=company) for acc in bank_accounts])
        return [{
            "Account Type": "Bank",
            "Total Balance": flt(total_balance)
        }]

    return result



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
        "value": float(total_balance),
        "fieldtype": "Currency"
    }