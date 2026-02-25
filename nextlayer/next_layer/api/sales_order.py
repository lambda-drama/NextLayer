

import random
import string

import frappe
from frappe import _
from frappe.utils import flt, nowdate
from erpnext.setup.utils import get_exchange_rate
from erpnext.accounts.party import get_party_account
from erpnext.accounts.utils import get_account_currency
from erpnext.accounts.doctype.accounting_dimension.accounting_dimension import (
    get_accounting_dimensions,
)


def create_payment_entry(doc, method=None):
    if not doc.custom_autocreate_payment_entry:
        return

    if not doc.custom_multi_payments:
        frappe.throw(_("Please add payment rows in Multi Payments table"))

    company_currency = frappe.get_value(
        "Company", doc.company, "default_currency"
    )

    created_entries = []
    total_paid = 0

    for row in doc.custom_multi_payments:

        paid_amt = flt(row.paid_amount)

        if paid_amt <= 0:
            continue

        if not row.payment_account:
            frappe.throw(_("Payment account missing in row #{0}")
                         .format(row.idx))

        total_paid += paid_amt

        pe = frappe.new_doc("Payment Entry")
        pe.payment_type = "Receive"
        pe.party_type = "Customer"
        pe.party = doc.customer
        pe.company = doc.company
        pe.posting_date = nowdate()

        # accounting dimensions
        pe.cost_center = doc.cost_center
        pe.project = doc.project

        for dimension in get_accounting_dimensions():
            if doc.get(dimension) and pe.meta.has_field(dimension):
                pe.set(dimension, doc.get(dimension))

        # mode of payment
        pe.mode_of_payment = row.mode_of_payment

        cheque_info = generate_unique_cheque_number(row.payment_account)
        pe.reference_date = cheque_info["reference_date"]
        pe.reference_no = cheque_info["reference_no"]

        # accounts
        pe.paid_to = row.payment_account

        pe.paid_from = get_party_account(
            "Customer", doc.customer, doc.company
        )

        if not pe.paid_from:
            frappe.throw(
                _("No Receivable account found for Customer {0}")
                .format(doc.customer)
            )

        pe.setup_party_account_field()

        pe.paid_from_account_currency = get_account_currency(pe.paid_from)
        pe.paid_to_account_currency = get_account_currency(pe.paid_to)

        # exchange rate
        rate = get_exchange_rate(
            pe.paid_to_account_currency,
            company_currency,
            pe.posting_date,
            "for_selling",
        )

        pe.exchange_rate = rate

        pe.received_amount = paid_amt
        pe.paid_amount = paid_amt * rate

        # reference sales order
        pe.append(
            "references",
            {
                "reference_doctype": "Sales Order",
                "reference_name": doc.name,
                "allocated_amount": pe.paid_amount,
            },
        )

        pe.set_missing_values()
        pe.set_amounts()

        pe.insert(ignore_permissions=True)
        pe.submit()

        created_entries.append(pe.name)

    # ✅ optional validation against SO paid amount
    if flt(doc.custom_paid_amount) and total_paid != flt(doc.custom_paid_amount):
        frappe.msgprint(
            _("Warning: Split payment total ({0}) differs from Paid Amount ({1})")
            .format(total_paid, doc.custom_paid_amount)
        )

    frappe.msgprint(
        _("Payment Entries created:<br>{0}")
        .format("<br>".join(created_entries))
    )

    return created_entries


def generate_unique_cheque_number(account_name, max_attempts=5):
    """
    Generate a unique cheque number based on account_name.
    Ensures the generated reference_no does not already exist in Payment Entry.
    """
    prefix = account_name[:4].upper()
    attempt = 0

    while attempt < max_attempts:
        random_part = "".join(
            random.choices(string.ascii_uppercase + string.digits, k=4)
        )
        reference_no = f"{prefix}-{random_part}"

        exists = frappe.db.exists("Payment Entry", {"reference_no": reference_no})
        if not exists:
            return {"reference_no": reference_no, "reference_date": nowdate()}
        attempt += 1

    frappe.throw("Unable to generate a unique cheque number after multiple attempts.")
