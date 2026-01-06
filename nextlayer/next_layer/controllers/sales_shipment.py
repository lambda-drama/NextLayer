

import frappe
from frappe import _
from frappe.utils import flt
from erpnext.accounts.utils import get_account_currency
from erpnext.accounts.general_ledger import make_gl_entries
from nextlayer.next_layer.utils import fetch_exchange_rate

def on_submit(doc, method=None):
    _make_gl_entries(doc)

def on_cancel(doc, method=None):
    delete_gl_entries(doc)

def _make_gl_entries(doc):
    if not doc.purchase_receipts or not len(doc.purchase_receipts):
        frappe.throw(_("Please link at least one receipt in Purchase Receipts table."))

    first_row = doc.purchase_receipts[0]
    if not first_row.receipt_document_type:
        frappe.throw(_("First row in Purchase Receipts is missing a receipt_document_type."))

    sales_invoice = first_row.receipt_document
    if not sales_invoice:
        frappe.throw(_("Could not determine Sales Invoice from Purchase Receipts child table."))

    company_currency = frappe.get_cached_value("Company", doc.company, "default_currency")
    company_abbreviation = frappe.db.get_value("Company", doc.company, "abbr")
    cost_center = "Main - " + str(company_abbreviation)

    # Get distinct income accounts from Sales Invoice Item child table
    income_accounts = frappe.get_all(
        "Sales Invoice Item",
        filters={"parent": sales_invoice},
        fields=["income_account"]
    )
    income_accounts = list(set([row.income_account for row in income_accounts if row.income_account]))

    if not income_accounts:
        frappe.throw(f"No Income Accounts found for Sales Invoice {sales_invoice}")

    gl_entries = []
    total_amount_company_currency = 0
    total_amount_account_currency = 0

    # Debit expense accounts from doc.taxes
    for row in doc.taxes:
        if not row.expense_account:
            frappe.throw(_("Row in Shipment Cost Distribution is missing an Expense Account."))
        if not row.amount:
            continue

        account_currency = get_account_currency(row.expense_account) or company_currency
        exchange_rate = 1.0

        if account_currency != company_currency:
            exchange_rate = frappe.db.get_value(
                "Currency Exchange",
                {"from_currency": company_currency, "to_currency": account_currency},
                "exchange_rate"
            ) or 1.0

        amount_in_company_currency = flt(row.base_amount, 2)
        amount_in_account_currency = flt(row.amount, 2)

        gl_entries.append(frappe._dict({
            "account": row.expense_account,
            "debit": 0,
            "debit_in_account_currency": 0,
            "credit": amount_in_company_currency,
            "credit_in_transaction_currency":amount_in_account_currency,
            "credit_in_account_currency": amount_in_account_currency,
            "account_currency": account_currency,
            "cost_center": cost_center,
            "against": ",".join(income_accounts),
            "voucher_type": "Sales Invoice",
        	"voucher_no": sales_invoice,
            "posting_date": doc.posting_date,
            "company": doc.company,
            "remarks": f"Sales Shipment Cost - {doc.name} for Sales Invoice {sales_invoice}",
            "branch": doc.branch,
            "company_group": doc.company_group,
            "marka": doc.marka,
        }))
        total_amount_company_currency += amount_in_company_currency
        total_amount_account_currency += amount_in_account_currency


    # Credit Income Account(s) with total
    income_account = income_accounts[0]
    account_currency = get_account_currency(income_account) or company_currency

    gl_entries.append(frappe._dict({
        "account": income_account,
        "debit": total_amount_company_currency,
        "debit_in_transaction_currency":total_amount_account_currency,
        "debit_in_account_currency": flt(total_amount_company_currency, 2),
        "credit": 0,
        "credit_in_account_currency": 0,
        "account_currency": account_currency,
        "cost_center": cost_center,
        "against": ",".join([d.expense_account for d in doc.taxes if d.expense_account]),
        "voucher_type": "Sales Invoice",
        "voucher_no": sales_invoice,
        "posting_date": doc.posting_date,
        "company": doc.company,
        "remarks": f"Sales Shipment Cost - {doc.name} for Sales Invoice {sales_invoice}",
        "branch": doc.branch,
        "company_group": doc.company_group,
        "marka": doc.marka,
    }))

    make_gl_entries(gl_entries, cancel=False, update_outstanding="No")
    
    # Mark GL as posted after successful creation
    frappe.db.set_value("Sales Shipment Cost", doc.name, "gl_posted", 1)
    frappe.db.commit()

def delete_gl_entries(doc):
    """
    Delete GL entries created by this specific Sales Shipment Cost document.
    Uses remarks field to identify entries, since multiple Sales Shipment Cost
    documents can reference the same Sales Invoice.
    """
    # Get the sales invoice from the first purchase receipt row
    sales_invoice = None
    if doc.purchase_receipts and len(doc.purchase_receipts) > 0:
        sales_invoice = doc.purchase_receipts[0].receipt_document
    
    if sales_invoice:
        # Delete by remarks field which contains the Sales Shipment Cost document name
        # This ensures we only delete GL entries created by THIS specific document
        frappe.db.sql("""
            DELETE FROM `tabGL Entry`
            WHERE voucher_type = %s
            AND voucher_no = %s
            AND remarks LIKE %s
        """, ("Sales Invoice", sales_invoice, f"Sales Shipment Cost - {doc.name}%"))
    else:
        # Fallback: if no sales invoice, delete by doctype and name (though this shouldn't happen)
        frappe.db.sql("""
            DELETE FROM `tabGL Entry`
            WHERE voucher_type=%s AND voucher_no=%s
        """, (doc.doctype, doc.name))
    
    # Mark GL as not posted after successful deletion
    frappe.db.set_value("Sales Shipment Cost", doc.name, "gl_posted", 0)
    frappe.db.commit()

@frappe.whitelist()
def check_gl_entries_exist(docname):
    """
    Check if GL entries exist for a Sales Shipment Cost document.
    Returns True if GL entries exist, False otherwise.
    """
    doc = frappe.get_doc("Sales Shipment Cost", docname)
    
    # Get the sales invoice from the first purchase receipt row
    sales_invoice = None
    if doc.purchase_receipts and len(doc.purchase_receipts) > 0:
        sales_invoice = doc.purchase_receipts[0].receipt_document
    
    if not sales_invoice:
        return {"exists": False}
    # Check if GL entries exist with remarks matching this Sales Shipment Cost
    gl_entries = frappe.db.sql("""
        SELECT COUNT(*) as count
        FROM `tabGL Entry`
        WHERE voucher_type = %s
        AND voucher_no = %s
        AND remarks LIKE %s
    """, ("Sales Invoice", sales_invoice, f"Sales Shipment Cost - {doc.name}%"), as_dict=True)
    
    exists = gl_entries[0].count > 0 if gl_entries else False
    
    return {"exists": exists}

@frappe.whitelist()
def repost_gl_entries(docname):
    """
    Repost GL entries for a Sales Shipment Cost document.
    Only accessible by System Manager and Admin.
    """
    # Check permissions - only System Manager and Administrator can repost
    user_roles = frappe.get_roles()
    allowed_roles = {"System Manager", "Administrator", "Stock Manager"}

    user_roles = set(frappe.get_roles(frappe.session.user))

    if not user_roles.intersection(allowed_roles):
        frappe.throw(
            _("You do not have permission to repost GL entries. Only System Manager, Administrator, or Stock Manager can perform this action.")
        )

    doc = frappe.get_doc("Sales Shipment Cost", docname)
    
    # Check if document is submitted
    if doc.docstatus != 1:
        frappe.throw(_("Document must be submitted before reposting GL entries."))
    
    try:
        # Delete existing GL entries (if any)
        delete_gl_entries(doc)
        
        # Recreate GL entries (this will set gl_posted = 1)
        _make_gl_entries(doc)
        
        frappe.msgprint(_("GL entries have been successfully reposted."), indicator="green")
        return {"success": True, "message": "GL entries reposted successfully"}
    except Exception as e:
        frappe.log_error(
            message=f"Error reposting GL entries for {docname}: {str(e)}",
            title="Repost GL Entries Error",
            reference_doctype="Sales Shipment Cost",
            reference_name=docname
        )
        frappe.throw(_("Error reposting GL entries: {0}").format(str(e)))

def update_landed_cost_rows(doc, method):
    company_currency = doc.company_currency
    for row in doc.taxes:  # child table = Sales Landed Cost Taxes and Charges
        if row.expense_account:
            account_currency = frappe.db.get_value("Account", row.expense_account, "account_currency")
            if account_currency and account_currency != company_currency:
                try:
                    rate = fetch_exchange_rate(account_currency, company_currency, doc.posting_date)
                    row.exchange_rate = flt(rate) or 1
                except Exception as e:
                    exchange_rate = frappe.db.get_value(
                        "Currency Exchange",
                        {"from_currency": company_currency, "to_currency": account_currency},
                        "exchange_rate"
                    ) or 1.0
                    
                    if exchange_rate == 1.0:
                        # Log the error only if manual lookup also failed
                        frappe.log_error(
                            message=f"Failed to fetch exchange rate for {account_currency} to {company_currency} on {doc.posting_date}. Both fetch_exchange_rate and manual Currency Exchange lookup failed. Using default rate of 1.0. Error: {str(e)}",
                            title="Exchange Rate Fetch Error",
                            reference_doctype=doc.doctype,
                            reference_name=doc.name
                        )
                    
                    row.exchange_rate = exchange_rate
                
                row.base_amount = flt(row.amount) * flt(row.exchange_rate)
            else:
                row.exchange_rate = 1
                row.base_amount = row.amount
