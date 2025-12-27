import frappe
from frappe.utils import flt

@frappe.whitelist()
def get_balance(company=None):
    """
    Returns bank balance details for a company using Frappe ORM (no SQL).
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
        fields=["name", "account_name"]
    )

    result = []
    total_balance = 0.0

    for acc in bank_accounts:
        account_balance = 0.0
        gl_entries = frappe.get_all(
            "GL Entry",
            filters={"account": acc.name, "company": company},
            fields=["debit", "credit"]
        )
        for entry in gl_entries:
            balance = flt(entry.debit) - flt(entry.credit)
            account_balance += balance
            total_balance += balance
        
        if account_balance != 0:
            result.append({
                "Account": acc.account_name or acc.name,
                "Balance": account_balance
            })

    # If no accounts with balance, return total
    if not result:
        return [{
            "Account Type": "Bank",
            "Total Balance": total_balance
        }]
    
    return result
