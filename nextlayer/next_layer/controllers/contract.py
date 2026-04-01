import frappe 
from frappe.model.naming import make_autoname


def get_contract_autoname(doc, method=None):
    company_abbr = frappe.db.get_value("Company", doc.custom_company, "abbr") or "CO"
    yy = frappe.utils.nowdate()[2:4]
    series = f"{company_abbr}-{yy}-.#####"
    doc.name = make_autoname(series, doc=doc) 