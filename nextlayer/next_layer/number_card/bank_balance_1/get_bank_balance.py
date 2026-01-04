import frappe
from frappe.utils.data import flt
from erpnext.accounts.utils import get_balance_on

def is_user_allowed_to_view_account(account_name, user=None):
    """
    Check if user is allowed to view an account based on custom_user_group.
    - Administrator and System Manager roles bypass all permission checks
    - If account has no custom_user_group, allow all users
    - If account has custom_user_group, only allow users who are members of that group
    """
    if not user:
        user = frappe.session.user
    
    # Administrator and System Manager bypass permission checks
    if user == "Administrator" or "System Manager" in frappe.get_roles(user):
        return True
    
    try:
        # Get the account's custom_user_group using db.get_value to avoid permission issues
        user_group = frappe.db.get_value("Account", account_name, "custom_user_group")
        
        # If no user group is set, allow all users
        if not user_group:
            return True
        
        # Check if user is a member of the user group
        # User Group has a child table called "User Group Member" with field "user"
        members = frappe.db.get_all(
            "User Group Member",
            filters={"parent": user_group},
            fields=["user"],
            pluck="user"
        )
        
        # Fallback: try accessing via document if database query doesn't work
        if not members:
            try:
                user_group_doc = frappe.get_cached_doc("User Group", user_group)
                if hasattr(user_group_doc, "user_group_members") and user_group_doc.user_group_members:
                    members = [member.user for member in user_group_doc.user_group_members if getattr(member, "user", None)]
            except Exception:
                pass
        
        # Strict check: user must be in members list, otherwise deny access
        if members and user in members:
            return True
        else:
            # User is not in the user group, deny access
            return False
            
    except Exception as e:
        # If there's an error checking permissions, log it and DENY access for security
        frappe.log_error(f"Error checking account permission for {account_name}: {str(e)}", "Account Permission Check")
        return False  # Default to denying access on error for security


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
        # Check if user has permission to view this account
        if not is_user_allowed_to_view_account(acc.name):
            continue
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
        # Check if user has permission to view this account
        if not is_user_allowed_to_view_account(acc.name):
            continue
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
