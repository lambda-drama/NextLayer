# Copyright (c) 2026, jr@gmail.com and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document
from frappe.utils import flt, nowdate
from frappe import _
from frappe.model.naming import make_autoname
from frappe.utils import cint
from datetime import datetime
from frappe.utils import nowdate, now, get_datetime, add_to_date, time_diff_in_seconds

class WageEntry(Document):
	def validate(self):
		self.calculate_totals()
  
	def before_save(self):
		self.generate_work_type_breakdown()
		
  
	def on_submit(self):
		create_daily_wage_purchase_invoice(self.name)
		self.add_checkin()

	def calculate_totals(self):
		"""Set amount per row (qty * rate) and total_qty, total_amount on main doc."""
		total_qty = 0
		total_amount = 0
		for row in self.wages or []:
			qty = flt(row.get("qty"), 0)
			rate = flt(row.get("rate"), 0)
			row.amount = qty * rate
			total_qty += qty
			total_amount += row.amount
		self.total_qty = total_qty
		self.total_amount = total_amount
  
	def autoname(self):
		get_wage_entry_autoname(self)
  
	def add_checkin(self):
		for row in self.wages:
			if not row.checkin:
				row.db_set('checkin', now())
    
	def generate_work_type_breakdown(self):
    # Group wages by type_of_work
		groups = {}
		for row in self.wages:
			key = row.type_of_work or 'Unspecified'
			if key not in groups:
				groups[key] = {
					'total_amount': 0,
					'total_qty': 0,
					'workers': 0,
					'daily_wage': 0,
					'default_expense_account': row.get('default_expense_account') or ''  # take from first row
				}
			groups[key]['total_amount'] += (row.amount or 0)
			groups[key]['total_qty']    += (row.qty or 1)
			groups[key]['workers']      += 1
			if row.get('daily_wage'):
				groups[key]['daily_wage'] = 1

		# Clear existing breakdown and rebuild
		self.type_of_work_breakdown = []

		for work_type, data in groups.items():
			self.append('type_of_work_breakdown', {
				'type_of_work':            work_type,
				'total_amount':            data['total_amount'],
				'total_qty':               data['total_qty'],
				'no_of_workers':           data['workers'],
				'daily_wage':              data['daily_wage'],
				'default_expense_account': data['default_expense_account'],
			})



def get_wage_entry_autoname(doc):
	"""
	Format: {Company Abbr}-{YY}-{#####}
	e.g. NL-25-00001, NL-25-00002
	Resets numbering each new year.
	"""
	company_abbr = frappe.db.get_value("Company", doc.company, "abbr") or "CO"
	yy = frappe.utils.nowdate()[2:4]  # e.g. "25" from "2025"
	series = f"{company_abbr}-{yy}-.#####"
	doc.name = make_autoname(series, doc=doc)



def get_expense_account_for_work_type(work_type, company):
    """
    Fetch the expense account for a given work type (Activity Type) and company.
    Looks inside Activity Type's custom_expense_account child table,
    which mirrors the Expense Claim Type accounts child table structure.
    Returns the account string, or throws a descriptive error if not found.
    """
    if not work_type:
        frappe.throw(_(
            "A wage row is missing a <b>Type of Work</b>. "
            "Please fill in all work types before booking."
        ))

    activity = frappe.get_doc("Activity Type", work_type)

    accounts_table = getattr(activity, "custom_expense_account", [])
    if not accounts_table:
        frappe.throw(_(
            "Activity Type <b>{0}</b> has no expense accounts configured. "
            "Please go to <b>Activity Type → {0}</b> and add an expense account "
            "for company <b>{1}</b>."
        ).format(work_type, company))

    # Find the row matching the current company
    for row in accounts_table:
        if row.get("company") == company:
            account = row.get("default_account") or row.get("account")
            if account:
                return account

    # Found the table but no matching company row
    frappe.throw(_(
        "Activity Type <b>{0}</b> does not have an expense account set for "
        "company <b>{1}</b>. "
        "Please go to <b>Activity Type → {0}</b> and add a row for this company."
    ).format(work_type, company))


def get_wage_entry_credit_account(doc):
    """
    Resolve the credit account for wage payment.
    Direct payment (Cash/Bank) takes priority over payable accrual.
    Returns (account_name, is_direct_payment).
    """
    payment_account = doc.get("payment_account")
    payable_account = doc.get("default_payable_account")

    if payment_account:
        return payment_account, True
    if payable_account:
        return payable_account, False

    frappe.throw(_(
        "Please set a <b>Payment Account</b> (Cash/Bank for direct payment) "
        "or <b>Payable Account</b> on the Wage Entry before creating a Journal Entry."
    ))


@frappe.whitelist()
def make_journal_entry(wage_entry_name, amount=None):
    doc = frappe.get_doc("Wage Entry", wage_entry_name)

    total_wages = sum(row.amount or 0 for row in doc.wages)
    if total_wages <= 0:
        frappe.throw(_("Total wage amount must be greater than zero."))

    payment_amount = float(amount) if amount else total_wages
    if payment_amount <= 0:
        frappe.throw(_("Payment amount must be greater than zero."))

    credit_account, is_direct_payment = get_wage_entry_credit_account(doc)

    company_currency = frappe.db.get_value("Company", doc.company, "default_currency")
    credit_account_currency = frappe.db.get_value("Account", credit_account, "account_currency")
    conversion_rate = getattr(doc, "conversion_rate", None) or 1

    accounts = []

    # --- DEBIT: group wages by work type, fetch account from Activity Type ---
    groups = {}
    for row in doc.wages:
        key = row.type_of_work or "General"
        if key not in groups:
            groups[key] = {"amount": 0}
        groups[key]["amount"] += (row.amount or 0)

    for work_type, data in groups.items():
        # Fetch expense account from Activity Type → custom_expense_account
        expense_account = get_expense_account_for_work_type(work_type, doc.company)

        expense_account_currency = frappe.db.get_value("Account", expense_account, "account_currency")
        prorated = (data["amount"] / total_wages) * payment_amount if total_wages else payment_amount

        accounts.append({
            "account":                    expense_account,
            "debit_in_account_currency":  prorated,
            "credit_in_account_currency": 0,
            "project":                    doc.project or "",
            "cost_center":                doc.cost_center or "",
            "user_remark":                work_type,
            "exchange_rate":              conversion_rate if company_currency != expense_account_currency else 1,
            "company_group":              doc.company_group or "",
        })

    # --- CREDIT: payment account (direct) or payable account ---
    credit_row = {
        "account":                    credit_account,
        "debit_in_account_currency":  0,
        "credit_in_account_currency": payment_amount,
        "project":                    doc.project or "",
        "cost_center":                doc.cost_center or "",
        "exchange_rate":              conversion_rate if company_currency != credit_account_currency else 1,
        "company_group":              doc.company_group or "",
        "reference_type":             "Wage Entry",
        "reference_name":             wage_entry_name,
    }

    # Party only applies when crediting a payable account, not Cash/Bank direct payment
    if not is_direct_payment and doc.party_type and doc.party:
        credit_row["party_type"] = doc.party_type
        credit_row["party"]      = doc.party

    accounts.append(credit_row)

    jv = frappe.get_doc({
        "doctype":        "Journal Entry",
        "voucher_type":   "Journal Entry",
        "posting_date":   doc.date or nowdate(),
        "company":        doc.company,
        "title":          f"Wages – {wage_entry_name}",
        "user_remark":    f"Wages – {wage_entry_name}",
        "accounts":       accounts,
        "multi_currency": 1 if (doc.currency and doc.currency != company_currency) else 0,
        "branch":         doc.branch or "",
    })

    jv.insert(ignore_permissions=True)
    jv.submit()

    update_wage_entry_payment_status(wage_entry_name)

    return jv.name

def update_wage_entry_payment_status(wage_entry_name):
	doc          = frappe.get_doc("Wage Entry", wage_entry_name)
	total_amount = float(doc.get("total_amount") or 0)

	result = frappe.db.sql("""
		SELECT COALESCE(SUM(jea.credit_in_account_currency), 0)
		FROM   `tabJournal Entry Account` jea
		JOIN   `tabJournal Entry`         je  ON je.name = jea.parent
		WHERE  jea.reference_type = 'Wage Entry'
		AND    jea.reference_name  = %(name)s
		AND    je.docstatus         = 1
	""", {"name": wage_entry_name})

	total_paid = float(result[0][0] or 0) if result else 0.0

	if total_amount > 0 and total_paid >= total_amount:
		new_status = "Paid"
	elif total_paid > 0:
		new_status = "Partly Paid"
	else:
		new_status = "Unpaid"

	if doc.get("status") != new_status:
		frappe.db.set_value("Wage Entry", wage_entry_name, "status", new_status)
		frappe.msgprint(
			_("Wage Entry {0} status updated to <b>{1}</b>. Paid: {2} of {3}.").format(
				wage_entry_name, new_status, total_paid, total_amount
			),
			indicator="green" if new_status == "Paid" else ("orange" if new_status == "Partly Paid" else "red"),
			alert=True,
		)

@frappe.whitelist()
def get_allowed_whatsapp_groups() -> list:
	"""
	Return WhatsApp groups the current user is permitted to message.
 
	Rules:
	  - System Manager sees all groups.
	  - If a group's user_permissions table is EMPTY → accessible by everyone.
	  - If a group's user_permissions table has rows → only listed users can see it.
	"""
	current_user = frappe.session.user
	
	# System Manager bypass
	if "System Manager" in frappe.get_roles(current_user):
		return frappe.get_all(
			"Whatsapp Group Profile",
			fields=["name", "group_name"],
			order_by="group_name asc",
		)
 
	all_groups = frappe.get_all(
		"Whatsapp Group Profile",
		fields=["name", "group_name"],
		order_by="group_name asc",
	)
 
	allowed = []
	for group in all_groups:
		total_permissions = frappe.db.count(
			"WhatsApp Group Access",
			filters={"parent": group["name"]},
		)
 
		if total_permissions == 0:
			# No restrictions — everyone can access
			allowed.append(group)
		elif frappe.db.exists(
			"WhatsApp Group Access",
			{"parent": group["name"], "user": current_user},
		):
			allowed.append(group)
	return allowed
 
 
 
# Add these methods to your existing wage_entry.py
# ─────────────────────────────────────────────────────────────────────────────
# Place ensure_daily_labour_item() and create_daily_wage_purchase_invoice()
# alongside your existing make_journal_entry() method.
# ─────────────────────────────────────────────────────────────────────────────

import frappe
from frappe import _
from frappe.utils import today


def ensure_daily_labour_item():
	"""Create the 'Daily Labour Charges' service item if it does not exist."""
	if frappe.db.exists("Item", "Daily Labour Charges"):
		return

	item = frappe.new_doc("Item")
	item.item_code          = "Daily Labour Charges"
	item.item_name          = "Daily Labour Charges"
	item.description        = "Daily Labour Charges"
	item.item_group         = "Service items UAE"          # adjust to your item group if needed
	item.stock_uom          = "Nos"               # or "Nos" — whichever fits your UOM list
	item.is_stock_item      = 0
	item.is_purchase_item   = 1
	item.is_sales_item      = 0
	item.insert(ignore_permissions=True)
	frappe.db.commit()

def _generate_invoice_no(company):
	"""
	Mirror the auto_name logic to produce a custom_invoice_no
	before the PI is inserted, so the mandatory field is always populated.
	"""
	company_abbr = frappe.db.get_value("Company", company, "abbr")
	if not company_abbr:
		frappe.throw(_("Company abbreviation not found for {0}").format(company))
 
	current_year = datetime.now().year
 
	if company == "CITYWALK FOOTWEAR PVT LTD":
		base_name = make_autoname(f"{company_abbr}-JW-.###")
	else:
		base_name = make_autoname(f"{company_abbr}-.####")
 
	return f"{base_name}-{current_year}"

@frappe.whitelist()
def create_daily_wage_purchase_invoice(wage_entry_name):
	"""
	Called automatically after Wage Entry submission (via JS after_submit hook).

	• Collects every Wage Breakdown Detail row where daily_wage == 1.
	• Ensures the 'Daily Labour Charges' item exists.
	• Creates and submits a single Purchase Invoice with one line per worker.
	• Returns the new PI name so the UI can show an alert.
	"""
	doc = frappe.get_doc("Wage Entry", wage_entry_name)

	# ── Guard: only run on submitted docs ────────────────────────────────────
	if doc.docstatus != 1:
		frappe.throw(_("Wage Entry must be submitted before creating a Purchase Invoice."))

	# ── Collect daily-wage rows ───────────────────────────────────────────────
	daily_rows = [w for w in doc.wages if cint(w.get("daily_wage"))]
	if not daily_rows:
		return None

	# ── Ensure item exists ────────────────────────────────────────────────────
	ensure_daily_labour_item()
	# ── Resolve supplier ──────────────────────────────────────────────────────
	# Try common field names; fall back to a generic "Daily Labour" supplier.
	supplier = (
		doc.get("supplier")
		or doc.get("party") if doc.get("party_type") == "Supplier" else None
		or _get_or_create_default_supplier()
	)
	invoice_no = _generate_invoice_no(doc.company)

	# ── Build Purchase Invoice ────────────────────────────────────────────────
	pi = frappe.new_doc("Purchase Invoice")
	pi.company          = doc.company
	pi.supplier         = supplier
	pi.custom_invoice_no = invoice_no
	pi.posting_date     = doc.get("date") or today()
	pi.due_date         = today()
	pi.cost_center      = doc.get("cost_center") or None
	pi.remarks          = _("Auto-created from Wage Entry {0}").format(wage_entry_name)
	pi.branch           = doc.get("branch") or None
	pi.company_group     = doc.get("company_group") or None
	pi.custom_remark     = doc.get("description") or None
	pi.custom_wage_entry = wage_entry_name
	pi.project = doc.get("project")

	# Link back to the Wage Entry (add a custom field if you want a hard link)
	# pi.custom_wage_entry = wage_entry_name

	for row in daily_rows:
		pi.append("items", {
			"item_code":       "Daily Labour Charges",
			"item_name":       "Daily Labour Charges",
			"description":     "{name} — {work}".format(
									name=row.get("name1") or "Worker",
									work=row.get("type_of_work") or row.get("work_group") or "",
							   ),
			"qty":             row.qty or 1,
			"rate":            row.rate or 0,
			"uom":             "Day",
			"cost_center":     doc.get("cost_center") or None,
			"expense_account": doc.get("default_expense_account") or None,
		})

	# Use the payable account from the Wage Entry if provided
	if doc.get("default_payable_account"):
		pi.credit_to = doc.default_payable_account

	pi.insert(ignore_permissions=True)
	pi.submit()
	frappe.db.commit()
	return pi.name


def _get_or_create_default_supplier():
	"""
	Returns the name of a generic 'Daily Labour' supplier,
	creating one if it doesn't already exist.
	"""
	supplier_name = "Daily Labour"

	if not frappe.db.exists("Supplier", supplier_name):
		sup = frappe.new_doc("Supplier")
		sup.supplier_name  = supplier_name
		sup.supplier_group = (
			frappe.db.get_single_value("Buying Settings", "supplier_group")
			or "All Supplier Groups"
		)
		sup.insert(ignore_permissions=True)
		frappe.db.commit()

	return supplier_name

import frappe

@frappe.whitelist()
def get_permitted_branches(doctype, txt, searchfield, start, page_len, filters):
    company = filters.get("company")

    # Get branches the user has explicit permission for
    user_permissions = frappe.get_all(
        "User Permission",
        filters={
            "user": frappe.session.user,
            "allow": "Branch",
        },
        pluck="for_value",
    )

    conditions = {"company": company}

    # Only apply user permission filter if permissions exist
    if user_permissions:
        conditions["name"] = ["in", user_permissions]

    return frappe.get_all(
        "Branch",
        filters=conditions,
        fields=["name"],
        as_list=True,
    )
    
@frappe.whitelist()
def checkout_worker(wage_entry_name, row_id):
    """Checkout a single worker"""
    wage_entry = frappe.get_doc("Wage Entry", wage_entry_name)
    
    # Get wage settings
    wage_settings = frappe.get_single("Wage Settings")
    avg_hours = wage_entry.average_working_hours or wage_settings.average_working_duration or 28800
    grace_minutes = int(wage_settings.early_exit_grace_period or 0)
    
    for row in wage_entry.wages:
        if row.name == row_id:
            if not row.checkin:
                frappe.throw(_("Worker has not checked in"))
            
            if row.checkout:
                frappe.throw(_("Worker already checked out"))
            
            # Check if enough time passed
            checkin_time = get_datetime(row.checkin)
            earliest_checkout = add_to_date(checkin_time, seconds=avg_hours - (grace_minutes * 60))
            
            if get_datetime(now()) < earliest_checkout:
                remaining = time_diff_in_seconds(earliest_checkout, now())
                minutes = int(remaining / 60)
                frappe.throw(_("Cannot checkout yet. Need {0} more minutes").format(minutes))
            
            # Set checkout
            row.checkout = now()
            
            # Calculate hours worked
            hours_worked = time_diff_in_seconds(row.checkout, row.checkin) / 3600
            
            # Update qty and amount
            if wage_entry.wage_type == "Daily":
                row.qty = 1 if hours_worked >= (avg_hours/3600) * 0.8 else round(hours_worked, 2)
            else:
                row.qty = round(hours_worked, 2)
            
            row.amount = row.qty * row.rate
            
            wage_entry.save()
            
            # Update totals
            total_qty = sum(r.qty or 0 for r in wage_entry.wages)
            total_amount = sum(r.amount or 0 for r in wage_entry.wages)
            wage_entry.db_set({
                "total_qty": total_qty,
                "total_amount": total_amount
            })
            
            frappe.db.commit()
            
            return {
                "success": True,
                "message": f"Checked out at {row.checkout}. Hours: {round(hours_worked, 2)}"
            }
    
    frappe.throw(_("Record not found"))
    
    
@frappe.whitelist()
def checkout_all_workers(wage_entry_name):
    """Checkout all workers at once"""
    wage_entry = frappe.get_doc("Wage Entry", wage_entry_name)
    
    if wage_entry.docstatus != 1:
        frappe.throw(_("Wage Entry must be submitted"))
    
    # Get wage settings
    wage_settings = frappe.get_single("Wage Settings")
    avg_hours = wage_entry.average_working_hours or wage_settings.average_working_duration or 28800
    grace_minutes = int(wage_settings.early_exit_grace_period or 0)
    
    checked_out = 0
    errors = []
    
    for row in wage_entry.wages:
        if not row.checkin:
            errors.append(f"{row.name1}: No checkin time")
            continue
        
        if row.checkout:
            continue
        
        # Check if enough time passed
        checkin_time = get_datetime(row.checkin)
        earliest_checkout = add_to_date(checkin_time, seconds=avg_hours - (grace_minutes * 60))
        
        if get_datetime(now()) < earliest_checkout:
            remaining = time_diff_in_seconds(earliest_checkout, now())
            minutes = int(remaining / 60)
            errors.append(f"{row.name1}: Need {minutes} more minutes")
            continue
        
        # Set checkout
        row.checkout = now()
        
        # Calculate actual working duration in seconds
        actual_duration_seconds = time_diff_in_seconds(row.checkout, row.checkin)
        
        # Update duration field
        row.duration = actual_duration_seconds
        
        checked_out += 1
    
    if checked_out > 0:
        wage_entry.save()
        frappe.db.commit()
    
    message = f"Checked out {checked_out} workers"
    if errors:
        message += f"\n\nErrors:\n" + "\n".join(errors[:5])
    
    return {
        "success": True,
        "message": message,
        "checked_out": checked_out,
        "errors": errors
    }