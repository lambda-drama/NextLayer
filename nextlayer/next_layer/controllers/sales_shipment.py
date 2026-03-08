

import time

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
            "transaction_currency": "USD",
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
        "transaction_currency": "USD",
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
    # Safety: never delete when doc.name is missing or blank. Otherwise the LIKE pattern
    # would become "Sales Shipment Cost - %" and wipe ALL Sales Shipment Cost
    # GL entries for that invoice (all documents), not just this one.
    doc_name = (getattr(doc, "name", None) or "").strip()
    if not doc_name:
        frappe.log_error(
            message="delete_gl_entries skipped: doc.name is missing or empty. Refusing to delete to avoid wiping all Sales Shipment Cost GL entries for the voucher.",
            title="Sales Shipment Cost GL Delete Skipped",
        )
        return

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
        """, ("Sales Invoice", sales_invoice, f"Sales Shipment Cost - {doc_name}%"))
    else:
        # Fallback: if no sales invoice, delete by doctype and name (though this shouldn't happen)
        frappe.db.sql("""
            DELETE FROM `tabGL Entry`
            WHERE voucher_type=%s AND voucher_no=%s
        """, (doc.doctype, doc_name))

    # Mark GL as not posted after successful deletion
    frappe.db.set_value("Sales Shipment Cost", doc_name, "gl_posted", 0)
    frappe.db.commit()

@frappe.whitelist()
def check_gl_entries_exist(docname):
    """
    Check if GL entries exist for a Sales Shipment Cost document.
    Returns True if non-cancelled GL entries exist, False otherwise.
    Button will appear if no entries exist OR all entries are cancelled.
    """
    doc = frappe.get_doc("Sales Shipment Cost", docname)
    
    # Get the sales invoice from the first purchase receipt row
    sales_invoice = None
    if doc.purchase_receipts and len(doc.purchase_receipts) > 0:
        sales_invoice = doc.purchase_receipts[0].receipt_document
    
    if not sales_invoice:
        return {"exists": False}
    # Check if non-cancelled GL entries exist with remarks matching this Sales Shipment Cost
    gl_entries = frappe.db.sql("""
        SELECT COUNT(*) as count
        FROM `tabGL Entry`
        WHERE voucher_type = %s
        AND voucher_no = %s
        AND remarks LIKE %s
        AND is_cancelled = 0
    """, ("Sales Invoice", sales_invoice, f"Sales Shipment Cost - {doc.name}%"), as_dict=True)
    
    exists = gl_entries[0].count > 0 if gl_entries else False
    
    return {"exists": exists}

def get_sales_shipment_cost_names_for_sales_invoice(sales_invoice_name):
    """
    Return list of submitted Sales Shipment Cost document names that are linked
    to the given Sales Invoice (via their purchase_receipts child table).
    """
    if not sales_invoice_name:
        return []
    meta = frappe.get_meta("Sales Shipment Cost")
    purchase_receipts_field = meta.get_field("purchase_receipts")
    if not purchase_receipts_field or not purchase_receipts_field.options:
        return []
    child_doctype = purchase_receipts_field.options
    rows = frappe.get_all(
        child_doctype,
        filters={
            "receipt_document_type": "Sales Invoice",
            "receipt_document": sales_invoice_name,
        },
        fields=["parent"],
        pluck="parent",
    )
    if not rows:
        return []
    # Only return submitted Sales Shipment Cost docs
    submitted = frappe.get_all(
        "Sales Shipment Cost",
        filters={"name": ["in", list(set(rows))], "docstatus": 1},
        pluck="name",
    )
    return submitted


def recreate_sales_shipment_cost_gl_for_sales_invoice(sales_invoice_name):
    """
    After Repost Accounting Ledger has run for a Sales Invoice, recreate the
    Sales Shipment Cost GL entries for that invoice (they are stored with
    voucher_type=Sales Invoice, voucher_no=si_name and get cancelled/deleted
    by the repost). For each linked Sales Shipment Cost doc: delete its GL
    entries then make them again.
    """
    for ssc_name in get_sales_shipment_cost_names_for_sales_invoice(sales_invoice_name):
        try:
            doc = frappe.get_doc("Sales Shipment Cost", ssc_name)
            delete_gl_entries(doc)
            _make_gl_entries(doc)
        except Exception as e:
            frappe.log_error(
                message=f"Recreate Sales Shipment Cost GL for SI {sales_invoice_name}, SSC {ssc_name}: {e}",
                title="Recreate Sales Shipment Cost GL",
            )
            raise


def recreate_sales_shipment_cost_gl_for_repost_doc(account_repost_doc):
    """
    Recreate Sales Shipment Cost GL for every Sales Invoice in the given
    Repost Accounting Ledger doc. Called after repost has run (from on_submit
    hook for sync case, or from enqueued job with delay for async case).
    """
    repost_doc = frappe.get_doc("Repost Accounting Ledger", account_repost_doc)
    if repost_doc.docstatus != 1:
        return
    for x in repost_doc.vouchers:
        if x.voucher_type == "Sales Invoice" and x.voucher_no:
            recreate_sales_shipment_cost_gl_for_sales_invoice(x.voucher_no)


def _normalize_riv_vouchers(vouchers):
    """Ensure each item is (voucher_type, voucher_no) for RIV voucher lists."""
    out = []
    for v in vouchers or []:
        if isinstance(v, (list, tuple)) and len(v) >= 2:
            out.append((v[0], v[1]))
        elif isinstance(v, dict):
            vt, vn = v.get("voucher_type"), v.get("voucher_no")
            if vt and vn:
                out.append((vt, vn))
    return out


def recreate_sales_shipment_cost_gl_after_repost_item_valuation(vouchers):
    """
    Recreate Sales Shipment Cost GL for every Sales Invoice in the list of
    (voucher_type, voucher_no) that was reposted by Repost Item Valuation.
    Same approach as Repost Accounting Ledger: repost wipes all GL for the
    voucher and recreates only from voucher.get_gl_entries(), so SSC GL are
    recreated here.
    """
    if not vouchers:
        return
    for voucher_type, voucher_no in vouchers:
        if voucher_type == "Sales Invoice" and voucher_no:
            try:
                recreate_sales_shipment_cost_gl_for_sales_invoice(voucher_no)
            except Exception as e:
                frappe.log_error(
                    message=f"Recreate Sales Shipment Cost GL for SI {voucher_no} after Repost Item Valuation: {e}",
                    title="Recreate Sales Shipment Cost GL (RIV)",
                )


def _recreate_sales_shipment_cost_gl_for_repost_doc_after_delay(account_repost_doc, delay_seconds=90):
    """
    Sleep then recreate SSC GL. Used when repost runs in background so our step
    runs after the repost job has had time to complete.
    """
    time.sleep(delay_seconds)
    recreate_sales_shipment_cost_gl_for_repost_doc(account_repost_doc)


def recreate_sales_shipment_cost_gl_after_repost_submit(doc, method=None):
    """
    Doc event: after Repost Accounting Ledger is submitted. Recreates Sales
    Shipment Cost GL for all Sales Invoices in the repost.
    - When repost runs synchronously (<=5 vouchers), the repost has already
      completed when this runs, so we run our step immediately.
    - When repost runs in background (>5 vouchers), we enqueue our step with
      a 90s sleep so it runs after the repost job completes.
    """
    if not doc.vouchers:
        return
    if len(doc.vouchers) > 5:
        frappe.enqueue(
            method="nextlayer.next_layer.controllers.sales_shipment._recreate_sales_shipment_cost_gl_for_repost_doc_after_delay",
            queue="default",
            timeout=400,
            account_repost_doc=doc.name,
            delay_seconds=90,
            enqueue_after_commit=True,
        )
    else:
        recreate_sales_shipment_cost_gl_for_repost_doc(doc.name)


@frappe.whitelist()
def repost_all_sales_shipment_cost_gl_for_company(company):
    """
    Find all submitted Sales Shipment Cost for the given company that have no
    GL entries (or need reposting) and repost GL for each. Used by the
    "Repost SSC" button on Company form.
    """
    allowed_roles = {"System Manager", "Administrator", "Stock Manager"}
    if not set(frappe.get_roles(frappe.session.user)).intersection(allowed_roles):
        frappe.throw(
            _("You do not have permission. Only System Manager, Administrator, or Stock Manager can repost.")
        )
    if not company:
        return {"reposted": 0, "total_checked": 0, "error": "Company is required"}

    names = frappe.get_all(
        "Sales Shipment Cost",
        filters={"company": company, "docstatus": 1},
        pluck="name",
    )
    reposted = 0
    for docname in names:
        result = check_gl_entries_exist(docname)
        if result and not result.get("exists"):
            try:
                doc = frappe.get_doc("Sales Shipment Cost", docname)
                delete_gl_entries(doc)
                _make_gl_entries(doc)
                reposted += 1
            except Exception as e:
                frappe.log_error(
                    message=f"Repost SSC for company {company}, doc {docname}: {e}",
                    title="Repost All Sales Shipment Cost GL",
                )
    return {"reposted": reposted, "total_checked": len(names)}


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


def _apply_repost_item_valuation_patch():
    """
    Patch Repost Item Valuation so that after each repost we recreate Sales
    Shipment Cost GL for affected Sales Invoices. "Start Reposting" enqueues the
    scheduler job repost_entries(), which calls repost(doc) — it never calls
    repost_now(), so we patch the module-level repost() and the scheduler entry
    repost_entries() to ensure our code runs.
    """
    try:
        import erpnext.stock.doctype.repost_item_valuation.repost_item_valuation as riv_module
    except ImportError:
        return
    if getattr(riv_module, "_nextlayer_riv_patch_applied", False):
        return

    _original_repost = riv_module.repost

    def _repost_with_ssc_recreate(doc):
        _original_repost(doc)
        # After repost: recreate Sales Shipment Cost GL for affected Sales Invoices
        try:
            directly_dependent = list(riv_module._get_directly_dependent_vouchers(doc))
            affected = list(riv_module.get_affected_transactions(doc))
            vouchers = _normalize_riv_vouchers(directly_dependent + affected)
            recreate_sales_shipment_cost_gl_after_repost_item_valuation(vouchers)
        except Exception as e:
            frappe.log_error(
                message=f"Recreate Sales Shipment Cost GL after RIV {getattr(doc, 'name', '')}: {e}",
                title="Recreate Sales Shipment Cost GL (RIV)",
            )

    riv_module.repost = _repost_with_ssc_recreate

    # Ensure patch is applied when scheduler runs repost_entries (worker may load erpnext first)
    _original_repost_entries = riv_module.repost_entries

    def _repost_entries_with_patch():
        _apply_repost_item_valuation_patch()
        return _original_repost_entries()

    riv_module.repost_entries = _repost_entries_with_patch
    riv_module._nextlayer_riv_patch_applied = True


_apply_repost_item_valuation_patch()
