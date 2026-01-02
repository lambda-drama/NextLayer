# Copyright (c) 2025, Next Layer and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document
from frappe import _
from frappe.utils import flt


class TravelExpense(Document):
	def validate(self):
		"""Calculate totals from child tables"""
		self.calculate_totals()
	
	def calculate_totals(self):
		"""Calculate total, total_taxes_and_charges, and grand_total in both transaction and company currency"""
		# Get company currency
		company_currency = None
		if self.company:
			company_currency = frappe.get_cached_value("Company", self.company, "default_currency")
		
		transaction_currency = self.currency
		
		# Calculate total from expenses child table (transaction currency)
		total = 0
		total_company_currency = 0
		if self.expenses:
			for expense in self.expenses:
				if expense.amount:
					total += flt(expense.amount)
				# Sum company currency amounts
				if expense.amount_company_currency:
					total_company_currency += flt(expense.amount_company_currency)
		
		self.total = total
		self.total_company_currency = total_company_currency
		
		# Calculate total taxes and charges (transaction currency)
		total_taxes_and_charges = 0
		total_taxes_and_charges_company_currency = 0
		if self.taxes_and_charges:
			for tax in self.taxes_and_charges:
				if tax.tax_amount:
					total_taxes_and_charges += flt(tax.tax_amount)
					# Convert tax amount to company currency if needed
					if transaction_currency and company_currency and transaction_currency != company_currency:
						try:
							transaction_date = self.posting_date or frappe.utils.today()
							exchange_rate = frappe.utils.get_exchange_rate(
								transaction_currency,
								company_currency,
								transaction_date,
								self.company
							)
							total_taxes_and_charges_company_currency += flt(tax.tax_amount) * exchange_rate
						except Exception:
							# If conversion fails, use same amount
							total_taxes_and_charges_company_currency += flt(tax.tax_amount)
					else:
						# Same currency, use same amount
						total_taxes_and_charges_company_currency += flt(tax.tax_amount)
		
		self.total_taxes_and_charges = total_taxes_and_charges
		self.total_taxes_and_charges_company_currency = total_taxes_and_charges_company_currency
		
		# Calculate grand total
		self.grand_total = flt(total) + flt(total_taxes_and_charges)
		self.grand_total_company_currency = flt(total_company_currency) + flt(total_taxes_and_charges_company_currency)
	
	def on_submit(self):
		"""Create Expense Claim when Travel Expense is submitted"""
		self.create_expense_claim()
	
	def create_expense_claim(self):
		"""Create an Expense Claim from Travel Expense"""
		try:
			# Get employee from traveler_name (Member)
			employee = None
			if self.traveler_name:
				# Try to get employee linked to member
				employee_list = frappe.get_all(
					"Employee",
					filters={"custom_member": self.traveler_name},
					fields=["name"],
					limit=1
				)
				if employee_list:
					employee = employee_list[0].name
			
			if not employee:
				frappe.throw(_("Please link an Employee to the Traveler (Member) {0}").format(self.traveler_name))
			
			# Create Expense Claim
			expense_claim = frappe.get_doc({
				"doctype": "Expense Claim",
				"employee": employee,
				"company": self.company,
				"expense_claim_date": self.posting_date,
				"custom_traveller_name": self.traveler_name,
				"custom_travel_group": self.travel_group,
				"custom_is_addition": self.is_addition,
				"company_group": self.company_group,
				"branch": self.branch,
				"marka": self.marka,
				"cost_center": self.cost_center,
				"project": self.project,
				"payable_account": self.payable_account,
				# Copy travel details
				"custom_flight_no": self.flight_no,
				"custom_departure_airport": self.custom_departure_airport,
				"custom_arrival_airport": self.custom_arrival_airport,
				"custom_airlines": self.custom_airlines,
				"custom_date_of_travel": self.custom_date_of_travel,
				"custom_date_of_arrival": self.custom_date_of_arrival,
				"custom_date_of_purchase": self.custom_date_of_purchase,
				"custom_booked_by": self.custom_booked_by,
				"custom_travel_type": self.custom_travel_type,
				"custom_pnr_number_": self.custom_pnr_number_,
			})
			
			# Add expenses from child table
			if self.expenses:
				for expense_row in self.expenses:
					expense_detail = {
						"expense_type": expense_row.expense_type,
						"expense_date": expense_row.expense_date,
						"amount": expense_row.amount,
						"sanctioned_amount": expense_row.sanctioned_amount or expense_row.amount,
						"description": expense_row.description,
						"cost_center": expense_row.cost_center or self.cost_center,
						"project": expense_row.project or self.project,
						# Hotel fields
						"hotel_checkin_date": expense_row.hotel_checkin_date,
						"hotel_checkout_date": expense_row.hotel_checkout_date,
						"custom_hotel_name": expense_row.custom_hotel_name,
						"hotel_territory": expense_row.hotel_territory,
						"hotel_location": expense_row.hotel_location,
						"hotel_city": expense_row.hotel_city,
						"hotel_country": expense_row.hotel_country,
						"purpose": expense_row.purpose,
						"rate_per_day": expense_row.rate_per_day,
						"total_nights": expense_row.get("total_nights"),
						# Travel fields
						"custom_prn_number": expense_row.custom_prn_number,
						"custom_date_of_purchase": expense_row.custom_date_of_purchase,
						"custom_travel_type": expense_row.custom_travel_type,
						"custom_booked_by": expense_row.custom_booked_by,
						"custom_departure_airport": expense_row.custom_departure_airport,
						"custom_arrival_airport": expense_row.custom_arrival_airport,
						"custom_airlines": expense_row.custom_airlines,
						"custom_date_of_travel": expense_row.custom_date_of_travel,
						"custom_date_of_arrival": expense_row.custom_date_of_arrival,
					}
					# Remove None values
					expense_detail = {k: v for k, v in expense_detail.items() if v is not None}
					expense_claim.append("expenses", expense_detail)
			
			# Add taxes and charges if any
			if self.taxes_and_charges:
				for tax_row in self.taxes_and_charges:
					expense_claim.append("taxes", {
						"account_head": tax_row.account_head,
						"rate": tax_row.rate,
						"description": tax_row.description,
						"tax_amount": tax_row.tax_amount,
						"total": tax_row.total,
						"cost_center": tax_row.cost_center or self.cost_center,
					})
			
			# Add advances if any
			if self.advances:
				for advance_row in self.advances:
					expense_claim.append("advances", {
						"employee_advance": advance_row.employee_advance,
						"posting_date": advance_row.posting_date,
						"advance_paid": advance_row.advance_paid,
						"unclaimed_amount": advance_row.unclaimed_amount,
						"allocated_amount": advance_row.allocated_amount,
					})
			
			# Insert and submit the expense claim
			expense_claim.insert(ignore_permissions=True)
			expense_claim.submit()
			frappe.db.commit()
			
			# Link back to Travel Expense
			self.expense_claim = expense_claim.name
			self.db_set("expense_claim", expense_claim.name)
			
			frappe.msgprint(
				_("Expense Claim {0} has been created and submitted.").format(
					frappe.bold(expense_claim.name)
				),
				indicator="green",
				alert=True
			)
			
		except Exception as e:
			frappe.log_error(
				f"Error creating Expense Claim from Travel Expense {self.name}: {str(e)}",
				"Travel Expense Error"
			)
			frappe.throw(_("Error creating Expense Claim: {0}").format(str(e)))



