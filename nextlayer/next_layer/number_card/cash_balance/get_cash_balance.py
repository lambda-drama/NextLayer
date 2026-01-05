import frappe
from frappe.utils import flt
from erpnext.setup.utils import get_exchange_rate


def is_user_allowed_to_view_account(account_name, user=None):
    """
    Check if user is allowed to view an account.
    First checks standard Frappe read permissions, then custom_user_group.
    - Administrator and System Manager roles bypass all permission checks
    - Step 1: Check standard Frappe read permission on Account document
    - Step 2: If standard permission passes, check custom_user_group
    - If account has no custom_user_group, allow if standard permission passes
    - If account has custom_user_group, only allow users who are members of that group
    """
    if not user:
        user = frappe.session.user
    
    # Administrator and System Manager bypass permission checks
    if user == "Administrator" or "System Manager" in frappe.get_roles(user):
        return True
    
    try:
        # Step 1: First check standard Frappe read permission on Account document
        try:
            # Check if account exists first
            if not frappe.db.exists("Account", account_name):
                return False
            
            account_doc = frappe.get_doc("Account", account_name)
            has_standard_permission = frappe.has_permission(
                doctype="Account",
                ptype="read",
                user=user,
                doc=account_doc
            )
            if not has_standard_permission:
                # User doesn't have standard read permission, deny access
                return False
        except frappe.PermissionError:
            # User doesn't have standard read permission, deny access
            return False
        except Exception as perm_error:
            # If there's an error checking standard permissions, log and deny for security
            frappe.log_error(f"Error checking standard permission for Account {account_name}: {str(perm_error)}", "Account Permission Check")
            return False
        
        # Step 2: If standard permission passes, check custom_user_group
        # Get the account's custom_user_group using db.get_value to avoid permission issues
        user_group = frappe.db.get_value("Account", account_name, "custom_user_group")
        
        # If no user group is set, allow access (standard permission already passed)
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
def get_cash_balance(company=None):
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
        fields=["name", "account_name", "account_currency"]
    )

    result = []
    total_balance = 0.0

    for acc in cash_accounts:
        # Check if user has permission to view this account
        if not is_user_allowed_to_view_account(acc.name):
            continue
        account_balance = 0.0
        # Use Frappe ORM to sum debit and credit from GL Entries
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
            # Get company currency as fallback
            company_currency = frappe.db.get_value("Company", company, "default_currency") or "USD"
            result.append({
                "Account": acc.account_name or acc.name,
                "Account Name": acc.name,
                "Currency": acc.account_currency or company_currency,  # Return account currency
                "Balance": account_balance
            })

    # If no accounts with balance, return total
    if not result:
        return [{
            "Account Type": "Cash",
            "Total Balance": total_balance
        }]
    
    return result


@frappe.whitelist()
def get_balance(company=None):
    """
    Returns total cash balance for a company using Frappe ORM only.
    Converts all account balances to company currency.
    """
    if not company:
        company = frappe.defaults.get_user_default("Company") or frappe.get_system_settings("default_company")

    if not company:
        return {
            "value": 0.0,
            "fieldtype": "Currency"
        }

    # Get company currency
    company_currency = frappe.db.get_value("Company", company, "default_currency") or "USD"

    # Get all Cash accounts for the company (non-group)
    cash_accounts = frappe.get_all(
        "Account",
        filters={
            "account_type": "Cash",
            "company": company,
            "is_group": 0
        },
        fields=["name", "account_currency"]
    )

    total_balance = 0.0
    posting_date = frappe.utils.today()

    for acc in cash_accounts:
        # Check if user has permission to view this account
        if not is_user_allowed_to_view_account(acc.name):
            continue
        
        # Get account currency (defaults to company currency if not set)
        account_currency = acc.get("account_currency") or company_currency
        
        # Use Frappe ORM to sum debit and credit from GL Entries
        gl_entries = frappe.get_all(
            "GL Entry",
            filters={"account": acc.name, "company": company},
            fields=["debit", "credit", "posting_date"]
        )
        
        account_balance = 0.0
        for entry in gl_entries:
            balance = flt(entry.debit) - flt(entry.credit)
            account_balance += balance
        
        # Convert to company currency if account currency is different
        if account_currency != company_currency and account_balance != 0:
            try:
                exchange_rate = get_exchange_rate(
                    account_currency,
                    company_currency,
                    posting_date,
                    company
                )
                account_balance = account_balance * exchange_rate
            except Exception:
                # If exchange rate not found, use balance as-is (log error)
                frappe.log_error(f"Exchange rate not found for {account_currency} to {company_currency}", "Cash Balance Currency Conversion")
        
        total_balance += account_balance

    return {
        "value": float(total_balance),
        "fieldtype": "Currency",
        "currency": company_currency
    }
