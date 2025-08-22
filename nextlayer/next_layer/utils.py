
# Server Script: Python
import frappe
from erpnext.setup.utils import get_exchange_rate

@frappe.whitelist()
def fetch_exchange_rate(from_currency, to_currency, posting_date=None):
    if not posting_date:
        posting_date = frappe.utils.today()
    try:
        rate = get_exchange_rate(from_currency, to_currency, posting_date)
        return rate
    except Exception:
        frappe.throw(f"Could not fetch exchange rate for {from_currency} to {to_currency}")
