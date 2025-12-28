import frappe

@frappe.whitelist()
def get_customer_to_delivery_count(company=None):
    """
    Returns count of Sales Orders To Deliver for a company.
    """
    if not company:
        company = frappe.defaults.get_user_default("Company") or frappe.get_system_settings("default_company")

    count = frappe.db.count(
        "Sales Order",
        filters={
            "company": company,
            "docstatus": 1,
            "status": ["in", ["To Deliver", "To Deliver and Bill", "To Bill"]]
        }
    )

    return {
        "value": count,
        "fieldtype": "Integer"
    }
