import frappe
import calendar
from frappe.model.document import Document
from frappe.utils import nowdate, flt, getdate, add_days, add_months
from datetime import timedelta

RENT_ITEM_CODE = "RENT-CHARGES"
RENT_ITEM_NAME = "Rent Charges"


class TenantContract(Document):
	def before_save(self):
		if self.tenant_sign and self.property_owner_sign and self.docstatus == 0:
			self.status = "Signed"

	def on_submit(self):
		if self.status != "Signed":
			frappe.throw("Cannot submit contract. Both tenant and property owner must sign the contract.")
		self.db_set("status", "Active")
		self._update_unit_on_activation()

	def on_cancel(self):
		self._update_unit_on_deactivation()

	def _update_unit_on_activation(self):
		if self.unit:
			frappe.db.set_value("Unit", self.unit, {
				"status": "Occupied",
				"is_occupied": 1,
				"current_tenant": self.party_name,
				"current_contract": self.name
			})

	def _update_unit_on_deactivation(self):
		if self.unit:
			frappe.db.set_value("Unit", self.unit, {
				"status": "Available",
				"is_occupied": 0,
				"current_tenant": None,
				"current_contract": None
			})

	@frappe.whitelist()
	def activate_contract(self):
		"""Admin override: manually activate contract without signature requirement."""
		if self.docstatus == 1 and self.status == "Active":
			frappe.throw("Contract is already active.")
		self.db_set("status", "Active")
		self._update_unit_on_activation()
		frappe.msgprint("Contract activated successfully.")

	@frappe.whitelist()
	def end_contract(self):
		if self.status != "Active":
			frappe.throw("Only active contracts can be ended.")
		self.db_set("status", "Expired")
		self._update_unit_on_deactivation()

	@frappe.whitelist()
	def terminate_contract(self):
		if self.status != "Active":
			frappe.throw("Only active contracts can be terminated.")
		self.db_set("status", "Terminated")
		self._update_unit_on_deactivation()

	# ──────────────────────────────────────────
	#  INVOICE GENERATION
	# ──────────────────────────────────────────

	@frappe.whitelist()
	def generate_sales_invoice(self):
		"""Generate sales invoice(s) from this contract, respecting PMS Settings grouping."""
		if self.status != "Active":
			frappe.throw("Only active contracts can generate invoices.")

		settings = _get_pms_settings()

		# ── Price list guard ──────────────────────────────────────────────────
		# Look up the price list configured for this contract's company in the
		# PMS Deposit Company Setting child table.  Alert the user if it is
		# missing so they know invoices will fall back to ERPNext defaults.
		price_list = _get_price_list_for_company(self.company, settings)
		if not price_list:
			frappe.msgprint(
				f"No Price List is configured for company <b>{self.company}</b> in "
				"PMS Settings → Company Deposit Settings. "
				"Invoices will use the customer's default price list. "
				"Please set a Price List to ensure correct pricing.",
				title="Price List Not Set",
				indicator="orange",
				alert=True,
			)
		# Store on self so _make_invoice can pick it up without re-fetching
		self._pms_price_list = price_list

		customer = self.get_customer_from_tenant()
		self._ensure_rent_item()

		grouping = self.invoice_grouping or (
			settings.invoice_grouping if settings else "Combined - All in one invoice"
		)

		invoices = []

		if grouping == "Combined - All in one invoice":
			inv = self._create_combined_invoice(customer, settings)
			if inv:
				invoices.append(inv)

		elif grouping in (
			"Rent + Services combined, Utilities separate",
			"Metered items only separate, rest combined",
		):
			inv = self._create_rent_services_invoice(customer, settings)
			if inv:
				invoices.append(inv)
			invoices.extend(self._create_utility_invoices_separate(customer, settings))

		elif grouping == "Rent separate, Services + Utilities combined":
			inv = self._create_rent_only_invoice(customer, settings)
			if inv:
				invoices.append(inv)
			inv = self._create_services_utilities_invoice(customer, settings)
			if inv:
				invoices.append(inv)

		elif grouping == "Fully separate (Rent, Services, Utilities)":
			inv = self._create_rent_only_invoice(customer, settings)
			if inv:
				invoices.append(inv)
			inv = self._create_services_only_invoice(customer, settings)
			if inv:
				invoices.append(inv)
			invoices.extend(self._create_utility_invoices_separate(customer, settings))

		else:
			inv = self._create_combined_invoice(customer, settings)
			if inv:
				invoices.append(inv)

		if not invoices:
			frappe.throw(
				"No items to invoice. Ensure rent is set, recurring service fees exist, "
				"or utility meters have current readings."
			)

		msg = (
			f"Invoice {invoices[0]} created successfully"
			if len(invoices) == 1
			else f"{len(invoices)} invoices created: {', '.join(invoices)}"
		)
		frappe.msgprint(msg)
		return invoices[0] if invoices else None

	# ── invoice-building helpers ──

	def _create_combined_invoice(self, customer, settings):
		items = (
			self._get_rent_items(settings)
			+ self._get_service_items(settings)
			+ self._get_utility_items(settings)
		)
		return self._make_invoice(customer, items, settings) if items else None

	def _create_rent_services_invoice(self, customer, settings):
		items = self._get_rent_items(settings) + self._get_service_items(settings)
		return self._make_invoice(customer, items, settings) if items else None

	def _create_rent_only_invoice(self, customer, settings):
		items = self._get_rent_items(settings)
		return self._make_invoice(customer, items, settings) if items else None

	def _create_services_only_invoice(self, customer, settings):
		items = self._get_service_items(settings)
		return self._make_invoice(customer, items, settings) if items else None

	def _create_services_utilities_invoice(self, customer, settings):
		items = self._get_service_items(settings) + self._get_utility_items(settings)
		return self._make_invoice(customer, items, settings) if items else None

	def _create_utility_invoices_separate(self, customer, settings):
		"""One invoice per utility row that has items."""
		invoices = []
		for utility in (self.utility or []):
			if not utility.tenant_pays:
				continue
			items = self._get_utility_items_for_row(utility, settings)
			if items:
				inv = self._make_invoice(customer, items, settings)
				if inv:
					invoices.append(inv)
		return invoices

	# ── line-item builders ──

	def _get_rent_items(self, settings):
		income_account = settings.default_rent_income_account if settings else None
		row = {
			"item_code": RENT_ITEM_CODE,
			"item_name": RENT_ITEM_NAME,
			"qty": 1,
			"rate": flt(self.monthly_rent),
			"description": f"Monthly Rent - {self.unit}",
			"uom": "Month",
		}
		if income_account:
			row["income_account"] = income_account
		return [row]

	def _get_service_items(self, settings):
		if not self.service_fee:
			return []

		income_account = settings.default_service_fee_account if settings else None
		combine = settings.combine_services_single_line if settings else 0
		rows = []

		for fee in self.service_fee:
			if not fee.apply_recurring:
				continue
			item_code = self._get_service_item_erpnext_code(fee)
			if not item_code:
				continue
			rows.append({
				"item_code": item_code,
				"item_name": fee.service_name or fee.service_item,
				"qty": 1,
				"rate": flt(fee.amount),
				"description": f"Service Fee: {fee.service_name or fee.service_item}",
				"income_account": income_account,
			})

		if combine and rows:
			total = sum(r["rate"] for r in rows)
			return [{
				"item_code": rows[0]["item_code"],
				"item_name": "Monthly Services",
				"qty": 1,
				"rate": total,
				"description": "Combined monthly service fees",
				"income_account": income_account,
			}]

		return rows

	def _get_utility_items(self, settings):
		items = []
		for utility in (self.utility or []):
			if utility.tenant_pays:
				items.extend(self._get_utility_items_for_row(utility, settings))
		return items

	def _get_utility_items_for_row(self, utility, settings):
		income_account = settings.default_utility_income_account if settings else None
		generate_zero = settings.generate_invoice_for_zero_consumption if settings else 0
		items = []

		if utility.billing_method == "Flat Fee":
			item_code = self._get_utility_item_code_safe(utility.utility_type)
			if item_code and flt(utility.flat_fee_amount) > 0:
				row = {
					"item_code": item_code,
					"item_name": f"{utility.utility_type} - Flat Fee",
					"qty": 1,
					"rate": flt(utility.flat_fee_amount),
					"description": f"{utility.utility_type} flat fee",
				}
				if income_account:
					row["income_account"] = income_account
				items.append(row)

		elif utility.billing_method == "Metered - Consumption Based":
			if not utility.meter:
				return items
			consumption, amount = self.calculate_utility_consumption(utility.meter)
			if consumption <= 0 and not generate_zero:
				return items
			item_code = self._get_utility_item_code_safe(utility.utility_type)
			if item_code:
				uom = self.get_utility_uom(utility.utility_type)
				row = {
					"item_code": item_code,
					"item_name": f"{utility.utility_type} - {self.unit}",
					"qty": consumption if consumption > 0 else 0,
					"rate": self.get_meter_rate(utility.meter),
					"description": f"{utility.utility_type} consumption for {nowdate()}",
					"uom": uom,
				}
				if income_account:
					row["income_account"] = income_account
				items.append(row)

		elif utility.billing_method == "Actual Bill Reimbursement":
			if flt(utility.flat_fee_amount) > 0:
				item_code = self._get_utility_item_code_safe(utility.utility_type)
				if item_code:
					row = {
						"item_code": item_code,
						"item_name": f"{utility.utility_type} - Actual Bill",
						"qty": 1,
						"rate": flt(utility.flat_fee_amount),
						"description": f"{utility.utility_type} actual bill reimbursement",
					}
					if income_account:
						row["income_account"] = income_account
					items.append(row)

		return items
	def _make_invoice(self, customer, items, settings, period_start=None, period_end=None):
		"""Build, insert and submit a Sales Invoice."""
		if not items:
			return None

		cost_center = settings.cost_center if settings else None
		if cost_center:
			for item in items:
				if not item.get("cost_center"):
					item["cost_center"] = cost_center

		due_date = self.get_due_date(settings)
		price_list = _get_price_list_for_company(self.company, settings)

		invoice_data = {
			"doctype": "Sales Invoice",
			"custom_invoice_no": self.generate_invoice_number(),
			"company": self.company,
			"customer": customer,
			"posting_date": period_end or nowdate(),
			"due_date": add_days(period_end, 7) or due_date,  # Default due date 7 days after period end or posting date
			"items": items,
			"currency": self.currency,
			"custom_unit": self.unit,
			"custom_tenant_contract": self.name,
			"custom_period_start": period_start,
			"custom_period_end": period_end,
			"set_posting_time": 1,
			"payment_terms_template": None,
			"payment_schedule": [],
		}
		if price_list:
			invoice_data["selling_price_list"] = price_list

		invoice = frappe.get_doc(invoice_data)
		invoice.insert()

		# ── Fix items: delete whatever ERPNext stored, re-insert correct ones ──
		frappe.db.delete("Sales Invoice Item", {"parent": invoice.name})
		invoice.items = []
		for idx, item in enumerate(items, start=1):
			invoice.append("items", {**item, "idx": idx})

		# ── Fix payment schedule: same pattern ──
		frappe.db.delete("Payment Schedule", {"parent": invoice.name})
		invoice.payment_terms_template = None
		invoice.payment_schedule = []
		invoice.due_date = due_date

		amount = flt(invoice.rounded_total or invoice.grand_total)
		if amount:
			invoice.append("payment_schedule", {
				"due_date": due_date,
				"invoice_portion": 100,
				"payment_amount": amount,
				"outstanding": amount,
			})

		invoice.submit()

		if settings and settings.send_invoice_automatically:
			try:
				invoice.send_emails()
			except Exception:
				pass

		return invoice.name
	# def _make_invoice(self, customer, items, settings):
	# 	"""Build, insert and submit a Sales Invoice."""
	# 	if not items:
	# 		return None

	# 	cost_center = settings.cost_center if settings else None
	# 	if cost_center:
	# 		for item in items:
	# 			if not item.get("cost_center"):
	# 				item["cost_center"] = cost_center

	# 	due_date = self.get_due_date(settings)
	# 	price_list = _get_price_list_for_company(self.company, settings)


	# 	invoice_data = {
	# 		"doctype": "Sales Invoice",
	# 		"custom_invoice_no": self.generate_invoice_number(),
	# 		"company": self.company,
	# 		"customer": customer,
	# 		"posting_date": nowdate(),
	# 		"due_date": due_date,
	# 		"items": items,
	# 		"currency": self.currency,
	# 		"custom_unit": self.unit,
	# 		"custom_tenant_contract": self.name,
	# 		"set_posting_time": 1,
   	# 		# "selling_price_list": price_list,
	# 		# Clear any customer/company default payment terms to prevent
	# 		# the ERPNext validator from auto-creating a payment schedule with
	# 		# duplicate due dates that clash with the due_date we set above.
	# 		"payment_terms_template": None,
	# 		"payment_schedule": [],
			
	# 	}
	# 	if price_list:
	# 		invoice_data["selling_price_list"] = price_list

	# 	invoice = frappe.get_doc(invoice_data)
	# 	invoice.insert()
		
	# 	# ── Payment schedule fix ─────────────────────────────────────────────
	# 	# ERPNext's validate() (called during both insert AND submit) runs
	# 	# set_payment_schedule(), which re-creates rows from the customer's
	# 	# payment terms template.  On the second pass (submit) this produces
	# 	# either duplicate-date rows or an amount mismatch.
	# 	#
	# 	# Fix: after insert we know the exact grand_total.  Purge every stale
	# 	# payment_schedule row from the DB *and* memory, then add back exactly
	# 	# one row that satisfies both validators (no duplicates, sum == total).
	# 	# frappe.db.delete("Payment Schedule", {"parent": invoice.name})
	# 	# invoice.payment_terms_template = None
	# 	# invoice.payment_schedule = []
	# 	# invoice.due_date = due_date

	# 	# amount = flt(invoice.rounded_total or invoice.grand_total)
	# 	# if amount:
	# 	# 	invoice.append("payment_schedule", {
	# 	# 		"due_date": due_date,
	# 	# 		"invoice_portion": 100,
	# 	# 		"payment_amount": amount,
	# 	# 		"outstanding": amount,
	# 	# 	})

	# 	invoice.submit()

	# 	if settings and settings.send_invoice_automatically:
	# 		try:
	# 			invoice.send_emails()
	# 		except Exception:
	# 			pass

	# 	return invoice.name
	
	# ──────────────────────────────────────────
	#  DAILY UTILITIES
	# ──────────────────────────────────────────

	@frappe.whitelist()
	def process_daily_utilities(self):
		if self.status != "Active":
			frappe.throw("Only active contracts can process utilities.")

		settings = _get_pms_settings()
		customer = self.get_customer_from_tenant()
		income_account = settings.default_utility_income_account if settings else None
		results = []

		for utility in (self.utility or []):
			if not (utility.tenant_pays and utility.billing_method == "Metered - Consumption Based"):
				continue
			if not utility.get("is_daily", 0):
				continue

			consumption, amount = self.calculate_daily_utility_consumption(utility.meter)
			if consumption <= 0:
				continue

			item_code = self._get_utility_item_code_safe(utility.utility_type)
			if not item_code:
				continue

			row = {
				"item_code": item_code,
				"item_name": f"{utility.utility_type} - {self.unit}",
				"qty": consumption,
				"rate": self.get_meter_rate(utility.meter),
				"description": f"{utility.utility_type} daily consumption for {nowdate()}",
				"uom": self.get_utility_uom(utility.utility_type),
			}
			if income_account:
				row["income_account"] = income_account

			inv_name = self._make_invoice(customer, [row], settings)
			results.append({
				"utility": utility.utility_type,
				"consumption": consumption,
				"amount": amount,
				"invoice": inv_name,
			})

		if results:
			frappe.msgprint(f"Processed {len(results)} daily utilities")
		else:
			frappe.msgprint("No daily utilities to process")

		return results

	# ──────────────────────────────────────────
	#  ITEM & CUSTOMER HELPERS
	# ──────────────────────────────────────────

	def _ensure_rent_item(self):
		"""Ensure Rent Charges ERPNext item exists."""
		if not frappe.db.exists("Item Group", "Rent"):
			frappe.get_doc({
				"doctype": "Item Group",
				"item_group_name": "Rent",
				"is_group": 0,
				"parent_item_group": "All Item Groups",
			}).insert(ignore_permissions=True)

		if not frappe.db.exists("UOM", "Month"):
			frappe.get_doc({"doctype": "UOM", "uom_name": "Month"}).insert(
				ignore_permissions=True
			)

		if not frappe.db.exists("Item", RENT_ITEM_CODE):
			frappe.get_doc({
				"doctype": "Item",
				"item_code": RENT_ITEM_CODE,
				"item_name": RENT_ITEM_NAME,
				"item_group": "Rent",
				"is_stock_item": 0,
				"is_sales_item": 1,
				"description": "Monthly Rent Charge",
				"stock_uom": "Month",
			}).insert(ignore_permissions=True)
			frappe.db.commit()

	def _get_service_item_erpnext_code(self, fee_row):
		"""Return ERPNext item_code for a service fee child row.
		Uses the linked Service Item's `item` field if set; otherwise auto-creates one.
		"""
		try:
			svc = frappe.get_doc("Service Item", fee_row.service_item)
		except Exception:
			return None

		if getattr(svc, "item", None):
			return svc.item
        
		# Auto-create/get ERPNext Item using service_item name as item_code
		item_code = fee_row.service_item
		if not frappe.db.exists("Item", item_code):
			if not frappe.db.exists("Item Group", "Services"):
				frappe.get_doc({
					"doctype": "Item Group",
					"item_group_name": "Services",
					"is_group": 0,
					"parent_item_group": "All Item Groups",
				}).insert(ignore_permissions=True)

			frappe.get_doc({
				"doctype": "Item",
				"item_code": item_code,
				"item_name": svc.service_name or item_code,
				"item_group": "Services",
				"is_stock_item": 0,
				"is_sales_item": 1,
				"description": getattr(svc, "description", None) or svc.service_name or item_code,
				"stock_uom": "Nos",
			}).insert(ignore_permissions=True)
			frappe.db.commit()

		return item_code

	def _get_utility_item_code_safe(self, utility_type):
		"""Like get_utility_item_code but returns None instead of throwing."""
		try:
			return self.get_utility_item_code(utility_type)
		except Exception as e:
			frappe.log_error(str(e), "Utility Item Code Error")
			return None

	def get_utility_item_code(self, utility_type):
		"""Get ERPNext item linked to Meter Type."""
		if not frappe.db.exists("Meter Type", utility_type):
			frappe.throw(
				f"Meter Type '{utility_type}' not found. "
				"Please create it in the Meter Type list and link an Item."
			)
		item = frappe.db.get_value("Meter Type", utility_type, "item")
		if not item:
			frappe.throw(
				f"Meter Type '{utility_type}' has no linked ERPNext Item. "
				"Please open the Meter Type record and set an Item."
			)
		return item

	def get_customer_from_tenant(self):
		if not self.party_name:
			frappe.throw("No tenant (Party Name) selected in this contract.")
		customer = frappe.db.get_value("Tenant", self.party_name, "customer")
		if not customer:
			frappe.throw(
				f"Tenant '{self.party_name}' has no linked Customer. "
				"Open the Tenant record and link a Customer."
			)
		return customer

	# ──────────────────────────────────────────
	#  METER CALCULATION HELPERS
	# ──────────────────────────────────────────

	def calculate_utility_consumption(self, meter_name):
		"""Calculate monthly consumption and reset meter readings."""
		meter = frappe.get_doc("Utility Meter", meter_name)

		if not meter.current_reading:
			frappe.throw(
				f"No current reading for meter '{meter_name}'. "
				"Please enter a reading before generating the invoice."
			)
		if meter.last_reading is None:
			frappe.throw(
				f"No last reading for meter '{meter_name}'. "
				"Please set an initial reading on the meter."
			)

		consumption = flt(meter.current_reading) - flt(meter.last_reading)
		if consumption < 0:
			frappe.log_error(
				f"Negative consumption for {meter.meter_id}: "
				f"last={meter.last_reading}, current={meter.current_reading}",
				"Utility Billing Error",
			)
			frappe.throw(
				f"Negative consumption detected for meter '{meter_name}'. "
				"Current reading must be ≥ last reading."
			)

		amount = consumption * flt(meter.tariff_rate)

		meter.db_set({
			"last_reading": meter.current_reading,
			"last_reading_date": meter.current_reading_date or nowdate(),
			"current_reading": 0,
			"current_reading_date": None,
			"last_invoice_date": nowdate(),
			"last_invoice_amount": amount,
		})
		return consumption, amount

	def calculate_daily_utility_consumption(self, meter_name):
		"""Calculate daily consumption (soft – returns 0, 0 on edge cases)."""
		meter = frappe.get_doc("Utility Meter", meter_name)
		if not meter.current_reading:
			return 0, 0
		if meter.last_reading is None:
			frappe.throw(f"No last reading for meter '{meter_name}'.")

		consumption = flt(meter.current_reading) - flt(meter.last_reading)
		if consumption < 0:
			return 0, 0

		amount = consumption * flt(meter.tariff_rate)
		meter.db_set({
			"last_reading": meter.current_reading,
			"last_reading_date": meter.current_reading_date or nowdate(),
			"current_reading": 0,
			"current_reading_date": None,
		})
		return consumption, amount

	def get_utility_uom(self, utility_type):
		uom = frappe.db.get_value("Meter Type", utility_type, "unit_of_measure")
		if uom:
			return uom
		fallback = {"Water": "Cubic Meter", "Electricity": "kWh", "Gas": "Therm"}
		return fallback.get(utility_type, "Nos")

	def get_meter_rate(self, meter_name):
		return flt(frappe.db.get_value("Utility Meter", meter_name, "tariff_rate"))

	# ──────────────────────────────────────────
	#  DUE DATE & INVOICE NUMBER
	# ──────────────────────────────────────────

	def get_due_date(self, settings=None):
		due_day = int(self.rent_due_day or (settings.rent_due_day if settings else 0) or 5)
		today = getdate(nowdate())
		max_day = calendar.monthrange(today.year, today.month)[1]
		due_day = min(due_day, max_day)

		if today.day <= due_day:
			return today.replace(day=due_day)

		if today.month == 12:
			return today.replace(year=today.year + 1, month=1, day=min(due_day, 31))
		next_month = today.month + 1
		return today.replace(
			month=next_month,
			day=min(due_day, calendar.monthrange(today.year, next_month)[1]),
		)

	def generate_invoice_number(self):
		abbr = self.get_company_abbreviation()
		year = nowdate()[:4]
		seq = self.get_next_invoice_sequence(abbr, year)
		return f"{abbr}-{year}-{seq:05d}"

	def get_company_abbreviation(self):
		if not self.company:
			frappe.throw("Company is required on the contract.")
		abbr = frappe.db.get_value("Company", self.company, "abbr")
		return (abbr or self.company[:3]).upper()

	def get_next_invoice_sequence(self, company_abbr, year):
		pattern = f"{company_abbr}-{year}-%"
		count = frappe.db.count(
			"Sales Invoice", filters={"custom_invoice_no": ["like", pattern]}
		)
		return (count or 0) + 1

	@frappe.whitelist()
	def generate_invoices_bulk(self, start_date, months):
		"""Generate invoices for multiple months"""
		
		if self.status != "Active":
			frappe.throw("Only active contracts can generate invoices.")
		
		
		start = getdate(start_date)
		months = int(months)
		
		all_invoices = []
		
		for i in range(months):
			# Calculate period for this month
			period_start = add_months(start, i)
			period_start = period_start.replace(day=1)
			
			# Calculate period end (last day of month)
			if period_start.month == 12:
				period_end = period_start.replace(year=period_start.year + 1, month=1, day=1) - timedelta(days=1)
			else:
				period_end = period_start.replace(month=period_start.month + 1, day=1) - timedelta(days=1)
			
			# Store period for invoice
			self._current_period_start = period_start
			self._current_period_end = period_end
			
			# Generate invoice for this period
			invoice_name = self._generate_single_invoice_for_period(period_start, period_end)
			
			if invoice_name:
				all_invoices.append(invoice_name)
		
		return all_invoices

	def _generate_single_invoice_for_period(self, period_start, period_end):
		"""Generate one invoice for a specific period"""

		settings = _get_pms_settings()
		customer = self.get_customer_from_tenant()
		self._ensure_rent_item()

		posting_date = period_end
		if self._check_existing_rent_invoice_for_month(posting_date):
			frappe.throw(
				f"Rent invoice already exists for {posting_date.strftime('%B %Y')}. "
				"Cannot create duplicate rent invoice."
			)

		items = []

		# Rent
		items.append({
			"item_code": RENT_ITEM_CODE,
			"item_name": RENT_ITEM_NAME,
			"qty": 1,
			"rate": flt(self.monthly_rent),
			"description": f"Rent for {self.unit} - {period_start} to {period_end}",
			"uom": "Month",
		})

		# Service fees (recurring)
		if self.service_fee:
			for fee in self.service_fee:
				if fee.apply_recurring:
					item_code = self._get_service_item_erpnext_code(fee)
					if item_code:
						items.append({
							"item_code": item_code,
							"item_name": fee.service_name or fee.service_item,
							"qty": 1,
							"rate": flt(fee.amount),
							"description": f"Service Fee: {fee.service_name or fee.service_item} - {period_start} to {period_end}",
						})

		# Utilities
		if self.utility:
			for utility in self.utility:
				if utility.tenant_pays:
					if utility.billing_method == "Flat Fee":
						item_code = self._get_utility_item_code_safe(utility.utility_type)
						if item_code and flt(utility.flat_fee_amount) > 0:
							items.append({
								"item_code": item_code,
								"item_name": f"{utility.utility_type} - Flat Fee",
								"qty": 1,
								"rate": flt(utility.flat_fee_amount),
								"description": f"{utility.utility_type} flat fee - {period_start} to {period_end}",
							})
					elif utility.billing_method == "Metered - Consumption Based":
						if utility.meter:
							consumption, amount = self.calculate_utility_consumption_for_period(
								utility.meter, period_start, period_end
							)
							if consumption > 0:
								item_code = self._get_utility_item_code_safe(utility.utility_type)
								if item_code:
									items.append({
										"item_code": item_code,
										"item_name": f"{utility.utility_type} - {self.unit}",
										"qty": consumption,
										"rate": self.get_meter_rate(utility.meter),
										"description": f"{utility.utility_type} consumption for {period_start} to {period_end}",
										"uom": self.get_utility_uom(utility.utility_type),
									})

		if not items:
			return None
		# ── Reuse _make_invoice which already handles payment schedule correctly ──
		return self._make_invoice(customer, items, settings, period_start=period_start, period_end=period_end)
	def _check_existing_rent_invoice_for_month(self, posting_date):
		"""Check if a rent invoice already exists for the given month.
		
		Args:
			posting_date: Date of the invoice (will check its year and month)
		
		Returns:
			bool: True if rent invoice exists for that month, False otherwise
		"""
		
		# Get year and month from posting date
		year = posting_date.year
		month = posting_date.month
		
		# Find all invoices for this contract
		existing_invoices = frappe.db.get_all(
			"Sales Invoice",
			filters={
				"custom_tenant_contract": self.name,
				"docstatus": ["!=", 2],  # Not cancelled
				"posting_date": ["between", [f"{year}-{month:02d}-01", f"{year}-{month:02d}-31"]]
			},
			fields=["name"]
		)
		
		for inv in existing_invoices:
			invoice = frappe.get_doc("Sales Invoice", inv.name)
			for item in invoice.items:
				if item.item_code == RENT_ITEM_CODE:
					return True
		
		return False
	def calculate_utility_consumption_for_period(self, meter_name, period_start, period_end):
		"""Calculate consumption for a specific period"""
		meter = frappe.get_doc("Utility Meter", meter_name)
		
		# Get readings at period start and end
		start_reading = self._get_reading_at_date(meter, period_start)
		end_reading = self._get_reading_at_date(meter, period_end)
		
		consumption = flt(end_reading) - flt(start_reading)
		
		if consumption < 0:
			return 0, 0
		
		amount = consumption * flt(meter.tariff_rate)
		return consumption, amount

	def _get_reading_at_date(self, meter, target_date):
		"""Get meter reading closest to target date"""
		# For now, use current reading if available
		if meter.current_reading_date and meter.current_reading_date <= target_date:
			return flt(meter.current_reading)
		
		# Fallback to last reading
		return flt(meter.last_reading or 0)

	def get_due_date_for_period(self, settings, period_end_date):
		"""Calculate due date based on period end"""
		due_day = int(self.rent_due_day or (settings.rent_due_day if settings else 0) or 5)
		
		from frappe.utils import getdate
		period_end = getdate(period_end_date)
		
		max_day = calendar.monthrange(period_end.year, period_end.month)[1]
		due_day = min(due_day, max_day)
		
		if period_end.day <= due_day:
			return period_end.replace(day=due_day)
		
		# Next month
		if period_end.month == 12:
			return period_end.replace(year=period_end.year + 1, month=1, day=min(due_day, 31))
		
		return period_end.replace(month=period_end.month + 1, day=due_day)

# ──────────────────────────────────────────
#  MODULE-LEVEL HELPERS
# ──────────────────────────────────────────

def _get_pms_settings():
	try:
		return frappe.get_single("PMS Settings")
	except Exception:
		return None


def _get_price_list_for_company(company, settings=None):
	"""
	Return the Price List configured for *company* in PMS Settings →
	Company Deposit Settings child table.  Returns None if not set.
	"""
	
	if not settings:
		settings = _get_pms_settings()
	if not settings:
		return None
	
	for row in (settings.company_deposit_settings or []):
		
		if row.company == company:
			return row.price_list or None
		
	frappe.throw(
		f"Company '{company}' not found in PMS Settings → Company Deposit Settings. "
		"Please add a row for this company and set a Price List to ensure correct pricing."
	)

	return None

