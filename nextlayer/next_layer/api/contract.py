# nextlayer/next_layer/custom/contract.py
# Place this file at the path above and call it from the client script

import frappe
from frappe import _
from frappe.utils import nowdate


@frappe.whitelist()
def make_journal_entry(contract_name, amount, stage_no):
    doc = frappe.get_doc("Contract", contract_name)

    amount    = float(amount)
    stage_no  = int(stage_no)

    # ---------- guard: all stages already paid ----------
    stages_paid  = int(doc.custom_stages_payment or 0)
    total_stages = int(doc.custom_stages or 0)

    if stages_paid >= total_stages:
        frappe.throw(_("All {0} stages have already been paid for this contract.").format(total_stages))

    # ---------- required account fields ----------
    expense_account = doc.get("custom_expense_account")
    payable_account = doc.get("custom_payable_account")
    company         = doc.get("custom_company")

    if not company:
        frappe.throw(_("Please set a Company on this Contract before creating a Journal Entry."))
    if not expense_account:
        frappe.throw(_("Please set an Expense Account on this Contract before creating a Journal Entry."))
    if not payable_account:
        frappe.throw(_("Please set a Payable Account on this Contract before creating a Journal Entry."))

    # ---------- currency / exchange-rate resolution (mirrors BonusPayout) ----------
    company_currency         = frappe.db.get_value("Company", company, "default_currency")
    expense_account_currency = frappe.db.get_value("Account", expense_account, "account_currency")
    payable_account_currency = frappe.db.get_value("Account", payable_account, "account_currency")
    conversion_rate          = float(doc.get("custom_conversion_rate") or 1) or 1

    # ---------- build accounts list ----------
    accounts = []

    # DEBIT – expense account
    accounts.append({
        "account":                    expense_account,
        "debit_in_account_currency":  amount,
        "credit_in_account_currency": 0,
        "exchange_rate":              conversion_rate if company_currency != expense_account_currency else 1,
        "user_remark":                f"Stage {stage_no} – {contract_name}",
    })

    # CREDIT – payable account (with party + back-reference, mirrors BonusPayout)
    credit_row = {
        "account":                    payable_account,
        "debit_in_account_currency":  0,
        "credit_in_account_currency": amount,
        "exchange_rate":              conversion_rate if company_currency != payable_account_currency else 1,
        "reference_type":             "Contract",   # links JE back to the Contract
        "reference_name":             contract_name,
    }

    if doc.party_type and doc.party_name:
        credit_row["party_type"] = doc.party_type
        credit_row["party"]      = doc.party_name

    accounts.append(credit_row)

    # ---------- create and submit Journal Entry ----------
    jv = frappe.get_doc({
        "doctype":       "Journal Entry",
        "voucher_type":  "Journal Entry",
        "posting_date":  doc.get("custom_posting_date") or nowdate(),
        "branch":         doc.get("custom_branch") or "",
        "cost_center":     doc.get("custom_cost_center") or "",
        "company":       company,
        "title":         payable_account,
        "user_remark":   f"Contract Stage {stage_no} Payment – {contract_name}",
        "accounts":      accounts,
        # only enable multi-currency when the contract currency differs from company currency
        "multi_currency": 1 if (doc.get("custom_currency") and doc.get("custom_currency") != company_currency) else 0,
    })

    jv.insert(ignore_permissions=True)
    jv.submit()

    # ---------- increment stages_payment counter ----------
    frappe.db.set_value("Contract", contract_name, "custom_stages_payment", stages_paid + 1)
    
    update_contract_payment_status(contract_name)
    return jv.name


def update_contract_payment_status(contract_name):
    """
    After each Journal Entry is created, re-evaluate the contract's payment status.
    
    Logic:
      - Fetch all submitted JEs referencing this contract
      - Sum their credit amounts
      - Compare total paid vs custom_amount
      - Also compare stages_payment vs custom_stages
      - Status → "Paid" if fully settled, "Partly Paid" if partially, else unchanged
    """
    doc = frappe.get_doc("Contract", contract_name)

    custom_amount  = float(doc.get("custom_amount") or 0)
    total_stages   = int(doc.get("custom_stages") or 0)
    stages_paid    = int(doc.get("custom_stages_payment") or 0)

    # ---------- sum all submitted JE credit rows linked to this contract ----------
    linked_je_amounts = frappe.db.sql("""
        SELECT SUM(jea.credit_in_account_currency)
        FROM   `tabJournal Entry Account` jea
        JOIN   `tabJournal Entry`         je  ON je.name = jea.parent
        WHERE  jea.reference_type = 'Contract'
        AND    jea.reference_name  = %(contract_name)s
        AND    je.docstatus         = 1
    """, {"contract_name": contract_name})

    total_paid = float(linked_je_amounts[0][0] or 0) if linked_je_amounts else 0.0

    # ---------- determine new status ----------
    new_status = None

    # Method 1 – amount-based check
    if custom_amount > 0:
        if total_paid >= custom_amount:
            new_status = "Paid"
        elif total_paid > 0:
            new_status = "Partly Paid"

    # Method 2 – stage-count check (overrides if more precise)
    if total_stages > 0:
        if stages_paid >= total_stages:
            new_status = "Paid"
        elif stages_paid > 0 and new_status != "Paid":
            new_status = "Partly Paid"

    # ---------- persist only if status changed ----------
    if new_status and doc.get("status") != new_status:
        frappe.db.set_value("Contract", contract_name, "status", new_status)
        frappe.msgprint(
            _("Contract {0} status updated to <b>{1}</b>. Total paid: {2} of {3}.").format(
                contract_name, new_status, total_paid, custom_amount
            ),
            indicator="green" if new_status == "Paid" else "orange",
            alert=True,
        )