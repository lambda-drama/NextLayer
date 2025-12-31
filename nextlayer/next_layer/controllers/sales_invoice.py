
import frappe
from frappe import _
from frappe.utils import flt, getdate, nowdate


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


@frappe.whitelist()
def generate_gl_invoice_number(customer, posting_date=None):
	"""
	Generate GL invoice number based on customer's Customer Group custom_unique_gl_series.
	Format: GLI-{year}-{5-digit-sequence} (e.g., GLI-26-00001, GLI-26-00002)
	Where year is the last 2 digits of the year (26 for 2025)

	Args:
		customer: Customer name
		posting_date: Optional posting date (defaults to today)

	Returns:
		dict with success status and invoice_number
	"""
	if not customer:
		return {
			"success": False,
			"message": "Customer is required"
		}

	# Get customer's Customer Group
	customer_group = frappe.db.get_value("Customer", customer, "customer_group")
	if not customer_group:
		return {
			"success": False,
			"message": "Customer Group not found for customer"
		}

	# Get custom_unique_gl_series from Customer Group
	gl_series = frappe.db.get_value("Customer Group", customer_group, "custom_unique_gl_series")
	if not gl_series:
		return {
			"success": False,
			"message": "Customer Group does not have custom_unique_gl_series set"
		}

	# Get year (last 2 digits) from posting_date or today
	if posting_date:
		year = str(getdate(posting_date).year)[-2:]
	else:
		year = str(getdate(nowdate()).year)[-2:]

	# Generate new invoice number in format GLI-{year}-{6-digit-sequence}
	# Get the last invoice number for this year
	last_invoice = frappe.db.sql("""
		SELECT custom_invoice_no
		FROM `tabSales Invoice`
		WHERE custom_invoice_no LIKE %s
		AND customer IN (
			SELECT name FROM `tabCustomer`
			WHERE customer_group = %s
		)
		ORDER BY CAST(SUBSTRING_INDEX(custom_invoice_no, '-', -1) AS UNSIGNED) DESC
		LIMIT 1
	""", (f"GLI-{year}-%", customer_group), as_dict=True)

	if last_invoice and last_invoice[0].custom_invoice_no:
		# Extract sequence number from last invoice
		# Format: GLI-{year}-{sequence}
		last_no = last_invoice[0].custom_invoice_no
		parts = last_no.split('-')
		if len(parts) >= 3:
			# Has sequence number (format: GLI-year-sequence)
			try:
				sequence = int(parts[-1]) + 1
			except ValueError:
				sequence = 1
		else:
			# Format: GLI-year (no sequence), start with 00001
			sequence = 1

		new_invoice_no = f"GLI-{year}-{sequence:05d}"
	else:
		# First invoice for this year
		new_invoice_no = f"GLI-{year}-00001"

	return {
		"success": True,
		"invoice_number": new_invoice_no
	}

