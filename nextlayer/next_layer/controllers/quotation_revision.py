import frappe
from frappe.model.document import Document

# Map the sequence of revision types
REVISION_SEQUENCE = ["Initial Quote", "After Site Visit", "Final Quote"]

@frappe.whitelist()
def create_next_revision(quotation_name):
    current_qtn = frappe.get_doc("Quotation", quotation_name)

    try:
        current_index = REVISION_SEQUENCE.index(current_qtn.custom_revision_type)
    except ValueError:
        frappe.throw("Current quotation revision type is not recognized.")
    
    if current_index >= len(REVISION_SEQUENCE) - 1:
        frappe.throw("This quotation is already the Final Quote. No further revision possible.")
    
    next_revision_type = REVISION_SEQUENCE[current_index + 1]

    # Create a copy
    new_qtn = frappe.copy_doc(current_qtn)
    new_qtn.name = None
    new_qtn.custom_revision_type = next_revision_type
    new_qtn.custom_parent_quotation = current_qtn.custom_parent_quotation or current_qtn.name
    new_qtn.status = "Draft"
    new_qtn.docstatus = 0

    new_qtn.submit_date = None
    new_qtn.letter_head = None

    new_qtn.insert()

    return new_qtn.name
