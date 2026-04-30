# nextlayer/next_layer/custom/contract.py
# Place this file at the path above and call it from the client script

from datetime import datetime

import frappe
from frappe import _
from frappe.model.naming import make_autoname
from frappe.utils import flt, nowdate


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


def _resolve_transport_contract_item_code(contract_doc):
	for row in contract_doc.get("custom_other_service_fee") or []:
		if row.get("item"):
			return row.item
		if row.get("service_item"):
			itm = frappe.db.get_value("Service Item", row.service_item, "item")
			if itm:
				return itm
	return None


def _purchase_invoice_invoice_no_for_company(company):
	if not company:
		return None
	company_abbr = frappe.db.get_value("Company", company, "abbr")
	if not company_abbr:
		frappe.throw(_("Company abbreviation not found for {0}").format(company))

	current_year = datetime.now().year

	if company == "CITYWALK FOOTWEAR PVT LTD":
		base_name = make_autoname(f"{company_abbr}-JW-.###")
	else:
		base_name = make_autoname(f"{company_abbr}-.####")

	return f"{base_name}-{current_year}"


def _purchase_invoice_linked_transport_contract(contract_name):
	"""Latest non-cancelled PI where Purchase Invoice.custom_contract_service points at this Contract."""
	meta = frappe.get_meta("Purchase Invoice")
	if not meta.has_field("custom_contract_service"):
		return None
	names = frappe.get_all(
		"Purchase Invoice",
		filters={"custom_contract_service": contract_name, "docstatus": ["!=", 2]},
		pluck="name",
		order_by="creation desc",
		limit_page_length=1,
	)
	return names[0] if names else None


@frappe.whitelist()
def get_transport_contract_service_invoice(contract_name):
	"""Used by Contract form to show View / Create Purchase Invoice."""
	frappe.get_doc("Contract", contract_name)
	return _purchase_invoice_linked_transport_contract(contract_name)


@frappe.whitelist()
def get_company_signees_from_settings(contract_type):
	"""Rows from Contract Settings → Contract Signee Members filtered by contract type."""
	if not contract_type:
		return []

	settings = frappe.get_single("Contract Settings")
	out = []
	for row in settings.contract_signee or []:
		if getattr(row, "contract_type", None) != contract_type:
			continue
		designation = getattr(row, "contract_designation", None)
		member = getattr(row, "member", None)
		if designation and member:
			out.append({"role": designation, "member": member})
	return out


@frappe.whitelist()
def mark_transport_contract_complete(contract_name):
	doc = frappe.get_doc("Contract", contract_name)
	frappe.has_permission("Contract", "write", doc=doc, throw=True)

	if doc.docstatus != 1:
		frappe.throw(_("Submit the contract first."))
	if doc.get("custom_contract_type") != "Transport Contract":
		frappe.throw(_("Only allowed for Transport Contract."))
	if doc.get("status") == "Completed":
		frappe.throw(_("This contract is already Completed."))

	doc.db_set("status", "Completed", update_modified=False)
	frappe.db.commit()
	doc.reload()
	# Return doc so the desk form can frappe.model.sync() and avoid a stale status + dirty save overwriting Completed.
	return doc.as_dict()


@frappe.whitelist()
def create_transport_contract_purchase_invoice(contract_name):
	"""Single-line PI: amount = contract Total Service Amount (transport)."""
	doc = frappe.get_doc("Contract", contract_name)
	frappe.has_permission("Contract", "write", doc=doc, throw=True)

	if doc.docstatus != 1:
		frappe.throw(_("Submit the contract first."))
	if doc.get("custom_contract_type") != "Transport Contract":
		frappe.throw(_("Only allowed for Transport Contract."))
	if doc.get("status") != "Completed":
		frappe.throw(_("Set contract Status to Completed first (Actions → Complete)."))

	pi_meta = frappe.get_meta("Purchase Invoice")
	if not pi_meta.has_field("custom_contract_service"):
		frappe.throw(
			_("Add Purchase Invoice custom field <code>custom_contract_service</code> (Link → Contract)."),
			title=_("Missing Custom Field"),
		)
	if _purchase_invoice_linked_transport_contract(contract_name):
		frappe.throw(_("A Purchase Invoice is already linked to this contract."))

	if doc.party_type != "Supplier":
		frappe.throw(_("Party Type must be Supplier to create the transport Purchase Invoice."))

	company = doc.get("custom_company")
	if not company:
		frappe.throw(_("Please set Company on the contract."))

	total_amt = flt(doc.get("custom_total_service_amount"))
	if total_amt <= 0:
		frappe.throw(_("Total Service Amount must be greater than zero."))

	item_code = _resolve_transport_contract_item_code(doc)
	if not item_code:
		frappe.throw(
			_("Add at least one Transport Contract Fee row with an Item, or set Item on the linked Service Item.")
		)

	expense_account = doc.get("custom_expense_account")
	payable_account = doc.get("custom_payable_account")
	if not expense_account:
		frappe.throw(_("Please set Expense Account on the contract."))
	if not payable_account:
		frappe.throw(_("Please set Payable Account on the contract."))

	pi = frappe.new_doc("Purchase Invoice")
	pi.company = company
	pi.supplier = doc.party_name
	pi.due_date = frappe.utils.add_days(nowdate(), 15)
	pi.posting_date = nowdate()
	pi.due_date = pi.posting_date
	pi.credit_to = payable_account
	pi.remarks = _("Transport contract service charges — {0}").format(doc.name)

	if pi_meta.has_field("custom_invoice_no"):
		pi.custom_invoice_no = _purchase_invoice_invoice_no_for_company(company)
	pi.custom_contract_service = doc.name
	for src, dest in (
		("custom_branch", "branch"),
		("custom_company_group", "company_group"),
		("custom_cost_center", "cost_center"),
		("custom_marka", "marka"),
	):
		if pi_meta.has_field(dest) and doc.get(src):
			pi.set(dest, doc.get(src))

	item_row = {
		"item_code": item_code,
		"qty": 1,
		"rate": total_amt,
		"description": _("Transport services — {0}").format(doc.name),
		"expense_account": expense_account,
	}
	if doc.get("custom_cost_center"):
		item_row["cost_center"] = doc.custom_cost_center
	if doc.get("custom_project"):
		item_row["project"] = doc.custom_project

	pi.append("items", item_row)

	company_currency = frappe.db.get_value("Company", company, "default_currency")
	contract_currency = doc.get("custom_currency")
	if (
		pi_meta.has_field("currency")
		and contract_currency
		and contract_currency != company_currency
	):
		pi.currency = contract_currency
	if (
		pi_meta.has_field("conversion_rate")
		and contract_currency
		and contract_currency != company_currency
	):
		pi.conversion_rate = flt(doc.get("custom_conversion_rate")) or 1.0

	pi.insert(ignore_permissions=True)
	pi.submit()

	frappe.db.commit()
	return pi.name
