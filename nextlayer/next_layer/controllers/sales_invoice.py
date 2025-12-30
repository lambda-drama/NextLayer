
import frappe
from frappe import _
from frappe.utils import flt


# def auto_pull_advances(doc, method=None):
#     """
#     Automatically pull advances from Payment Entries linked to the Sales Order
#     when creating a Sales Invoice from a Sales Order.
#     Runs on before_save hook.
#     """
#     # Get Sales Order - check direct field first, then items
#     sales_order = getattr(doc, 'sales_order', None)

#     if not sales_order and doc.items:
#         # Get Sales Order from items
#         for item in doc.items:
#             if item.sales_order:
#                 sales_order = item.sales_order
#                 break

#     if not sales_order:
#         return

#     # Skip if advances are already present (user may have manually added them)
#     if doc.advances and len(doc.advances) > 0:
#         return

#     # Skip if document is already submitted
#     if doc.docstatus == 1:
#         return

#     # Pull advances manually from Payment Entries
#     _pull_advances_manually(doc, sales_order)


# def _pull_advances_manually(doc, sales_order):
#     """
#     Fallback method to manually pull advances from Payment Entries.
#     """
#     # Find Payment Entries linked to this Sales Order
#     payment_entries = frappe.db.sql("""
#         SELECT
#             pe.name,
#             pe.paid_amount,
#             pe.received_amount,
#             pe.paid_to,
#             pe.paid_from,
#             pe.party,
#             pe.posting_date,
#             pe.modified,
#             pe.paid_to_account_currency as currency,
#             per.name as reference_row_name,
#             per.allocated_amount,
#             per.outstanding_amount
#         FROM `tabPayment Entry` pe
#         INNER JOIN `tabPayment Entry Reference` per ON pe.name = per.parent
#         WHERE per.reference_doctype = 'Sales Order'
#             AND per.reference_name = %s
#             AND pe.docstatus = 1
#             AND pe.party_type = 'Customer'
#             AND pe.party = %s
#             AND pe.payment_type = 'Receive'
#             # AND per.outstanding_amount > 0
#         ORDER BY pe.posting_date DESC
#     """, (sales_order, doc.customer), as_dict=True)

#     if not payment_entries:
#         return

#     # Clear existing advances
#     doc.set("advances", [])

#     # Add advances from Payment Entries
#     for pe in payment_entries:
#         # Use outstanding amount from the reference
#             # allocated_amount = flt(pe.outstanding_amount, 2)
#         allocated_amount = flt(pe.allocated_amount, 2)
#         if allocated_amount:
#             # Determine the advance account
#             advance_account = pe.paid_to if pe.paid_to else doc.debit_to
#             advance_row = doc.append("advances", {})
#             advance_row.allocated_amount = allocated_amount
#             advance_row.advance_amount = allocated_amount
#             advance_row.advance_account = advance_account
#             advance_row.difference_posting_date = pe.posting_date
#             advance_row.reference_type = "Payment Entry"
#             advance_row.reference_name = pe.name
#             advance_row.reference_row = pe.reference_row_name  # Link to Payment Entry Reference row
#             advance_row.remarks = f"Auto-pulled from Payment Entry {pe.name} linked to Sales Order {sales_order}"

    # # Calculate and update totals
    # doc.calculate_taxes_and_totals()


@frappe.whitelist()
def fetch_advances_from_sales_order_api(sales_order, customer, sales_invoice_name=None):
    """
    API method to fetch and pull advances from Payment Entries linked to the Sales Order.
    Can be called from JavaScript validate event (runs before Python validate).
    Returns the advances data so JavaScript can add them directly to the form.

    Args:
        sales_order: Sales Order name
        customer: Customer name
        sales_invoice_name: Optional Sales Invoice name (for existing documents)
    """
    if not sales_order or not customer:
        return {
            "success": False,
            "message": "Sales Order and Customer are required"
        }

    # If document exists, check if advances are already present
    if sales_invoice_name:
        try:
            doc = frappe.get_doc("Sales Invoice", sales_invoice_name)
            if doc.advances and len(doc.advances) > 0:
                return {
                    "success": False,
                    "message": "Advances already exist"
                }
            if doc.docstatus == 1:
                return {
                    "success": False,
                    "message": "Cannot pull advances for submitted Sales Invoice"
                }
            # Use document's debit_to account if available
            debit_to = doc.debit_to
        except frappe.DoesNotExistError:
            debit_to = None
    else:
        debit_to = None

    # Get Payment Entries linked to this Sales Order
    payment_entries = frappe.db.sql("""
        SELECT
            pe.name,
            pe.paid_amount,
            pe.received_amount,
            pe.paid_to,
            pe.paid_from,
            pe.party,
            pe.posting_date,
            pe.modified,
            pe.paid_to_account_currency as currency,
            per.name as reference_row_name,
            per.allocated_amount,
            per.outstanding_amount
        FROM `tabPayment Entry` pe
        INNER JOIN `tabPayment Entry Reference` per ON pe.name = per.parent
        WHERE per.reference_doctype = 'Sales Order'
            AND per.reference_name = %s
            AND pe.docstatus = 1
            AND pe.party_type = 'Customer'
            AND pe.party = %s
            AND pe.payment_type = 'Receive'
        ORDER BY pe.posting_date DESC
    """, (sales_order, customer), as_dict=True)

    if not payment_entries:
        return {
            "success": False,
            "message": "No Payment Entries found linked to this Sales Order"
        }

    # Build advances data to return
    advances_data = []
    for pe in payment_entries:
        allocated_amount = flt(pe.allocated_amount, 2)
        if allocated_amount:
            # Determine advance account - use paid_to, or fallback to debit_to if available
            advance_account = pe.paid_to
            if not advance_account and debit_to:
                advance_account = debit_to
            elif not advance_account and sales_invoice_name:
                # Get default debit_to account for customer from the document
                try:
                    doc = frappe.get_doc("Sales Invoice", sales_invoice_name)
                    if doc.debit_to:
                        advance_account = doc.debit_to
                except:
                    advance_account = None

            if advance_account:
                advances_data.append({
                    "allocated_amount": allocated_amount,
                    "advance_amount": allocated_amount,
                    "advance_account": advance_account,
                    "difference_posting_date": pe.posting_date,
                    "reference_type": "Payment Entry",
                    "reference_name": pe.name,
                    "reference_row": pe.reference_row_name,
                    "remarks": f"Auto-pulled from Payment Entry {pe.name} linked to Sales Order {sales_order}"
                })

    return {
        "success": True,
        "message": f"Found {len(advances_data)} advance(s)",
        "advances": advances_data
    }

