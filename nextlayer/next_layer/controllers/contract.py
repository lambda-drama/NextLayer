import frappe
from frappe.model.naming import make_autoname


def get_contract_autoname(doc, method=None):
    company_abbr = frappe.db.get_value("Company", doc.custom_company, "abbr") or "CO"
    yy = frappe.utils.nowdate()[2:4]
    series = f"{company_abbr}-{yy}-.#####"
    doc.name = make_autoname(series, doc=doc)


def preserve_transport_completed_before_update(doc, method=None):
    """
    ERPNext Contract.before_update_after_submit resets status from dates (Active/Inactive).
    Preserve Completed for Transport contracts — DB still holds previous status until commit.
    """
    if doc.get("custom_contract_type") != "Transport Contract" or not doc.name:
        return
    prev = frappe.db.get_value("Contract", doc.name, "status")
    if prev == "Completed":
        doc.status = "Completed"


def restore_transport_completed_after_daily_contract_sync():
    """
    ERPNext maintenance runs update_status_for_contracts() which overwrites status for all signed contracts.
    Re-apply Completed when this Transport contract already has a submitted transport-service PI linked.
    """
    if not frappe.get_meta("Purchase Invoice").has_field("custom_contract_service"):
        return
    names = frappe.db.sql(
        """
        select distinct pi.custom_contract_service
        from `tabPurchase Invoice` pi
        inner join `tabContract` c on c.name = pi.custom_contract_service
        where pi.docstatus = 1
          and c.docstatus = 1
          and ifnull(c.custom_contract_type, '') = 'Transport Contract'
          and coalesce(pi.custom_contract_service, '') != ''
        """,
        pluck=True,
    )
    for contract_name in names or []:
        frappe.db.set_value("Contract", contract_name, "status", "Completed", update_modified=False)