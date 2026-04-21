

import frappe
from frappe.model.document import Document
from frappe.utils import nowdate, add_days, flt

class TenantContract(Document):
	def before_save(self):
		if self.tenant_sign and self.property_owner_sign and self.docstatus == 0:
			self.status = "Signed"

	def on_submit(self):
		if self.status != "Signed":
			frappe.throw("Cannot submit contract. Both tenant and property owner must sign the contract.")
		self.db_set("status", "Active")
		self.set_unit_status("Occupied")

	def on_cancel(self):
		self.set_unit_status("Available")

	def set_unit_status(self, status):
		if self.unit:
			frappe.db.set_value("Unit", self.unit, "status", status)

	@frappe.whitelist()
	def end_contract(self):
		if self.status != "Active":
			frappe.throw("Only active contracts can be ended.")
		self.db_set("status", "Expired")
		self.set_unit_status("Available")

	@frappe.whitelist()
	def terminate_contract(self):
		if self.status != "Active":
			frappe.throw("Only active contracts can be terminated.")
		self.db_set("status", "Terminated")
		self.set_unit_status("Available")

	# ============== NEW INVOICE METHODS ==============

	@frappe.whitelist()
	def generate_sales_invoice(self):
		"""Generate sales invoice from this contract"""
		if self.status != "Active":
			frappe.throw("Only active contracts can generate invoices.")
		
		# Ensure Rent item exists
		self.create_rent_item_if_not_exists()
		
		# Get customer from Tenant doctype
		customer = self.get_customer_from_tenant()
		
		items = []
		
		# 1. Rent item
		items.append({
			"item_code": "RENT",
			"item_name": "Monthly Rent",
			"qty": 1,
			"rate": self.monthly_rent,
			"description": f"Rent for {self.unit} - {nowdate()}",
			"uom": "Month"
		})
		
		# 2. Service fees (recurring only)
		if self.service_fee:
			for fee in self.service_fee:
				if fee.is_recurring:
					items.append({
						"item_code": fee.service_item,
						"item_name": fee.service_name or fee.service_item,
						"qty": 1,
						"rate": fee.amount,
						"description": f"Recurring fee: {fee.service_item}"
					})
		
		# 3. Utilities (metered)
		if self.utility:
			for utility in self.utility:
				if utility.tenant_pays and utility.billing_method == "Metered - Consumption Based":
					consumption, amount = self.calculate_utility_consumption(utility.meter)
					if consumption > 0:
						items.append({
							"item_code": self.get_utility_item_code(utility.utility_type),
							"item_name": f"{utility.utility_type} - {self.unit}",
							"qty": consumption,
							"rate": self.get_meter_rate(utility.meter),
							"description": f"{utility.utility_type} consumption for {nowdate()}",
							"uom": self.get_utility_uom(utility.utility_type)
						})
		
		if not items:
			frappe.throw("No items to invoice. Check rent, service fees, and utilities.")
		
		# Create invoice
		invoice = frappe.get_doc({
			"doctype": "Sales Invoice",
			"custom_invoice_no": self.generate_invoice_number(),
			"company": self.company,
			"customer": customer,
			"posting_date": nowdate(),
			"due_date": self.get_due_date(),
			"items": items
		})
		
		invoice.insert()
		invoice.submit()
		
		frappe.msgprint(f"Invoice {invoice.name} created successfully")
		return invoice.name

	@frappe.whitelist()
	def process_daily_utilities(self):
		"""Process daily utilities for this contract"""
		if self.status != "Active":
			frappe.throw("Only active contracts can process utilities.")
		
		# Get customer from Tenant doctype
		customer = self.get_customer_from_tenant()
		
		results = []
		
		for utility in self.utility:
			if utility.tenant_pays and utility.billing_method == "Metered - Consumption Based" and utility.get("is_daily", 0):
				consumption, amount = self.calculate_daily_utility_consumption(utility.meter)
				
				if consumption > 0:
					invoice_name = self.create_utility_invoice(utility, consumption, amount, customer)
					results.append({
						"utility": utility.utility_type,
						"consumption": consumption,
						"amount": amount,
						"invoice": invoice_name
					})
		
		if results:
			frappe.msgprint(f"Processed {len(results)} daily utilities")
		else:
			frappe.msgprint("No daily utilities to process")
		
		return results

	# ============== ITEM CREATION METHODS ==============

	def create_rent_item_if_not_exists(self):
		"""Create Rent item if it doesn't exist"""
		
		# Check if Service item group exists
		self.create_service_item_group()
		
		# Check if Rent item exists
		if not frappe.db.exists("Item", "RENT"):
			rent_item = frappe.get_doc({
				"doctype": "Item",
				"item_code": "RENT",
				"item_name": "Monthly Rent",
				"item_group": "Service",
				"is_stock_item": 0,
				"description": "Monthly Rent Charge",
				"standard_rate": 0
			})
			rent_item.insert()
			frappe.db.commit()

	def create_service_item_group(self):
		"""Create 'Service' item group if it doesn't exist"""
		if not frappe.db.exists("Item Group", "Service"):
			item_group = frappe.get_doc({
				"doctype": "Item Group",
				"item_group_name": "Service",
				"parent_item_group": "All Item Groups"
			})
			item_group.insert()
			frappe.db.commit()

	def get_customer_from_tenant(self):
		"""Get customer from Tenant doctype"""
		if not self.party_name:
			frappe.throw("No tenant selected in contract.")
		
		tenant = frappe.get_doc("Tenant", self.party_name)
		
		if not tenant.customer:
			frappe.throw(f"Tenant {self.party_name} does not have a linked customer.")
		
		return tenant.customer

	# ============== HELPER METHODS ==============

	def calculate_utility_consumption(self, meter_name):
		"""Calculate consumption for a meter (monthly)"""
		meter = frappe.get_doc("Utility Meter", meter_name)
		
		if not meter.current_reading:
			frappe.throw(f"No current reading for meter {meter_name}")
		
		if not meter.last_reading:
			frappe.throw(f"No last reading for meter {meter_name}. Please set initial reading.")
		
		consumption = flt(meter.current_reading) - flt(meter.last_reading)
		
		if consumption < 0:
			frappe.log_error(
				f"Negative consumption for meter {meter.meter_id}. "
				f"Last: {meter.last_reading}, Current: {meter.current_reading}",
				"Utility Billing Error"
			)
			frappe.throw(f"Negative consumption detected for meter {meter_name}")
		
		amount = consumption * flt(meter.tariff_rate)
		
		# Update meter for next period
		meter.last_reading = meter.current_reading
		meter.last_reading_date = meter.current_reading_date or nowdate()
		meter.current_reading = 0
		meter.current_reading_date = None
		meter.save()
		
		return consumption, amount

	def calculate_daily_utility_consumption(self, meter_name):
		"""Calculate consumption for a meter (daily)"""
		meter = frappe.get_doc("Utility Meter", meter_name)
		
		if not meter.current_reading:
			return 0, 0
		
		if not meter.last_reading:
			frappe.throw(f"No last reading for meter {meter_name}. Please set initial reading.")
		
		consumption = flt(meter.current_reading) - flt(meter.last_reading)
		
		if consumption < 0:
			frappe.log_error(
				f"Negative daily consumption for meter {meter.meter_id}. "
				f"Last: {meter.last_reading}, Current: {meter.current_reading}",
				"Daily Utility Billing Error"
			)
			return 0, 0
		
		amount = consumption * flt(meter.tariff_rate)
		
		# Update meter for next day
		meter.last_reading = meter.current_reading
		meter.last_reading_date = meter.current_reading_date or nowdate()
		meter.current_reading = 0
		meter.current_reading_date = None
		meter.save()
		
		return consumption, amount

	def create_utility_invoice(self, utility, consumption, amount, customer):
		"""Create a utility invoice"""
		invoice = frappe.get_doc({
			"doctype": "Sales Invoice",
			"customer": customer,
			"posting_date": nowdate(),
			"due_date": self.get_due_date(),
			"items": [{
				"item_code": self.get_utility_item_code(utility.utility_type),
				"item_name": f"{utility.utility_type} - {self.unit}",
				"qty": consumption,
				"rate": self.get_meter_rate(utility.meter),
				"description": f"{utility.utility_type} daily consumption for {nowdate()}",
				"uom": self.get_utility_uom(utility.utility_type)
			}]
		})
		
		invoice.insert()
		invoice.submit()
		
		return invoice.name

	def get_due_date(self):
		"""Calculate due date based on rent due day"""
		due_day = self.rent_due_day or 1
		from frappe.utils import getdate
		today = getdate(nowdate())
		
		if today.day <= due_day:
			due_date = today.replace(day=due_day)
		else:
			# Next month
			if today.month == 12:
				due_date = today.replace(year=today.year + 1, month=1, day=due_day)
			else:
				due_date = today.replace(month=today.month + 1, day=due_day)
		
		return due_date

	def get_utility_item_code(self, utility_type):
		"""Get item code for utility type"""
		# First try to get from Meter Type doctype
		meter_type = frappe.db.exists("Meter Type", utility_type)
		if meter_type:
			item = frappe.db.get_value("Meter Type", meter_type, "item")
			if item:
				return item
		
		# Fallback to hardcoded map
		item_map = {
			"Water": "UTIL-WATER",
			"Electricity": "UTIL-ELECTRICITY",
			"Gas": "UTIL-GAS",
			"Sewer": "UTIL-SEWER",
			"Trash": "UTIL-TRASH"
		}
		return item_map.get(utility_type, "UTIL-OTHER")

	def get_utility_uom(self, utility_type):
		"""Get UOM for utility type"""
		# First try to get from Meter Type doctype
		meter_type = frappe.db.exists("Meter Type", utility_type)
		if meter_type:
			uom = frappe.db.get_value("Meter Type", meter_type, "unit_of_measure")
			if uom:
				return uom
		
		# Fallback to hardcoded map
		uom_map = {
			"Water": "Cubic Meter",
			"Electricity": "kWh",
			"Gas": "Therm",
			"Sewer": "Cubic Meter",
			"Trash": "Unit"
		}
		return uom_map.get(utility_type, "Unit")

	def get_meter_rate(self, meter_name):
		"""Get tariff rate from meter"""
		return frappe.db.get_value("Utility Meter", meter_name, "tariff_rate")
	
	def generate_invoice_number(self):
		"""Generate invoice number in format: COMPANY-YYYY-XXXXX"""
		
		# Get company abbreviation
		company_abbr = self.get_company_abbreviation()
		
		# Get current year
		year = nowdate().split("-")[0]  # "2026"
		
		# Get next sequence number for this year
		sequence = self.get_next_invoice_sequence(year)
		
		# Format: COMPANY-2026-00001
		invoice_number = f"{company_abbr}-{year}-{sequence:05d}"
		
		return invoice_number


	def get_company_abbreviation(self):
		"""Get company abbreviation from Company doctype"""
		
		if not self.company:
			frappe.throw("Company is required on the contract.")
		
		company = frappe.get_doc("Company", self.company)
		
		# Try to get abbreviation from custom field or use first letters
		if hasattr(company, "abbreviation") and company.abbreviation:
			return company.abbreviation.upper()
		
		# Default: Take first 3 letters of company name, uppercase
		abbr = ''.join(word[0] for word in company.company_name.split()[:2])
		return abbr.upper()[:5]  # Max 5 characters


	def get_next_invoice_sequence(self, year):
		"""Get next sequence number for invoices in given year"""
		
		# Count existing invoices with this year's prefix
		pattern = f"{self.get_company_abbreviation()}-{year}-%"
		
		existing_invoices = frappe.db.count("Sales Invoice", {
			"name": ["like", pattern]
		})
		
		# Next sequence = existing count + 1
		return existing_invoices + 1