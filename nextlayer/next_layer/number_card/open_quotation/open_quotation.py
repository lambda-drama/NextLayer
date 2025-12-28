import frappe

@frappe.whitelist()
def get_open_quotation_count(company=None):
    """
    Returns count of Open Quotations for a company.
    """
    if not company:
        company = frappe.defaults.get_user_default("Company") or frappe.get_system_settings("default_company")

    count = frappe.db.count(
        "Quotation",
        filters={
            "company": company,
            "docstatus": 1,
            "status": "Open"
        }
    )

    return {
        "value": count,
        "fieldtype": "Integer"
    }
