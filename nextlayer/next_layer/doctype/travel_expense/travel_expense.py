# Copyright (c) 2025, Next Layer and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document
from frappe import _
from frappe.utils import flt


class TravelExpense(Document):
	def validate(self):
		"""Calculate totals and sync multi-city to expenses when applicable"""
		self._sync_multi_city_to_expenses()
		self.calculate_totals()

	def _sync_multi_city_to_expenses(self):
		"""When trip_type is Multi City, ensure one Travel expense row and fill it from multi_city_segments (first segment = departure/PRN/dates, last = arrival)."""
		trip_type = getattr(self, "trip_type", None)
		if trip_type != "Multi City":
			return
		segments = getattr(self, "multi_city_segments", None) or []
		if not segments or len(segments) == 0:
			return
		first = segments[0]
		last = segments[-1]
		# Find or create one Travel expense row
		travel_row = None
		if self.expenses:
			for row in self.expenses:
				if row.expense_type and "travel" in (row.expense_type or "").lower():
					travel_row = row
					break
		if not travel_row:
			self.append("expenses", {
				"expense_type": "Travel",
				"expense_date": self.posting_date or frappe.utils.today(),
				"amount": flt(getattr(self, "travel_amount", 0)) or 0,
				"amount_company_currency": flt(getattr(self, "amountcompany_currency", 0)) or 0,
				"sanctioned_amount": flt(getattr(self, "amountcompany_currency", 0)) or 0,
			})
			travel_row = self.expenses[-1]
		# Map from first/last segment to Travel Expense Detail (main child table)
		travel_row.custom_departure_airport = first.get("departure_airport")
		travel_row.custom_arrival_airport = last.get("arrival_airport")
		travel_row.custom_prn_number = first.get("custom_prn_number")
		travel_row.custom_date_of_purchase = first.get("date_of_purchase")
		travel_row.custom_travel_type = "Multi-city"
		travel_row.custom_date_of_travel = first.get("date_of_travel")
		travel_row.custom_date_of_arrival = last.get("date_of_arrival")
		travel_row.custom_airlines = first.get("airlines")
		if getattr(self, "travel_amount", 0) and not travel_row.amount:
			travel_row.amount = flt(self.travel_amount)
		if getattr(self, "amountcompany_currency", 0) and not travel_row.amount_company_currency:
			travel_row.amount_company_currency = flt(self.amountcompany_currency)
			travel_row.sanctioned_amount = flt(self.amountcompany_currency)
		if self.posting_date and not travel_row.expense_date:
			travel_row.expense_date = self.posting_date
	
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

	def _validate_attachment_if_enforced(self):
		"""If NextLayer Settings has enforce_attachment_on_travel_expense, ensure at least one attachment exists."""
		try:
			settings = frappe.get_single("Travel Expense Settings")
		except Exception:
			return
		if not getattr(settings, "enforce_attachment_on_travel_expense", False):
			return
		has_attachment = frappe.db.exists(
			"File",
			{"attached_to_doctype": "Travel Expense", "attached_to_name": self.name},
		)
		if not has_attachment:
			frappe.throw(
				_("At least one attachment is required to submit this Travel Expense. Please attach a file and try again.")
			)
	
	def on_submit(self):
		"""Create Expense Claim and Journal Entry when Travel Expense is submitted"""
		self._validate_attachment_if_enforced()

		# Create journal entry based on is_paid status
		if self.is_paid:
			# When is_paid is ticked, create journal entry with expense and payment entries
			from nextlayer.next_layer.api.travel_expense_utils import create_journal_entry_for_paid_travel_expense
			try:
				journal_entry_name = create_journal_entry_for_paid_travel_expense(self)
				if journal_entry_name:
					frappe.msgprint(
						_("Journal Entry {0} has been created and submitted.").format(
							frappe.bold(journal_entry_name)
						),
						indicator="green",
						alert=True
					)
			except Exception as e:
				frappe.log_error(
					f"Error creating journal entry for Travel Expense {self.name}: {str(e)}",
					"Travel Expense Error"
				)
				# Don't prevent submission if journal entry creation fails
				frappe.msgprint(
					_("Warning: Could not create journal entry. Please create it manually."),
					indicator="orange",
					alert=True
				)
		else:
			# When is_paid is not ticked, create journal entry for payment only
			from nextlayer.next_layer.api.travel_expense_utils import create_journal_entry_for_travel_expense
			try:
				journal_entry_name = create_journal_entry_for_travel_expense(self)
				if journal_entry_name:
					frappe.msgprint(
						_("Journal Entry {0} has been created and submitted.").format(
							frappe.bold(journal_entry_name)
						),
						indicator="green",
						alert=True
					)
			except Exception as e:
				frappe.log_error(
					f"Error creating journal entry for Travel Expense {self.name}: {str(e)}",
					"Travel Expense Error"
				)
				# Don't prevent submission if journal entry creation fails
				frappe.msgprint(
					_("Warning: Could not create journal entry. Please create it manually."),
					indicator="orange",
					alert=True
				)
	
	# def create_expense_claim(self):
	# 	"""Create an Expense Claim from Travel Expense
		
	# 	Returns:
	# 		str: Expense Claim name if created successfully, None otherwise
	# 	"""
	# 	try:
	# 		# Get employee from traveler_name (Member)
	# 		# Note: Member is a standalone doctype and may not be linked to Employee
	# 		employee = None
	# 		if self.traveler_name:
	# 			# Try different methods to find employee linked to member
	# 			# Method 1: Check if Member doctype has employee field
	# 			try:
	# 				member_doc = frappe.get_doc("Member", self.traveler_name)
	# 				if hasattr(member_doc, 'employee') and member_doc.employee:
	# 					employee = member_doc.employee
	# 				elif hasattr(member_doc, 'custom_employee') and member_doc.custom_employee:
	# 					employee = member_doc.custom_employee
	# 			except Exception:
	# 				pass
				
	# 			# Method 2: Try to find employee by name matching (if member name matches employee name)
	# 			if not employee:
	# 				try:
	# 					employee_list = frappe.get_all(
	# 						"Employee",
	# 						filters={"employee_name": self.traveler_name},
	# 						fields=["name"],
	# 						limit=1
	# 					)
	# 					if employee_list:
	# 						employee = employee_list[0].name
	# 				except Exception:
	# 					pass
				
	# 			# Method 3: Try custom_member field if it exists (for backward compatibility)
	# 			if not employee:
	# 				try:
	# 					# Check if custom_member field exists first
	# 					employee_fields = frappe.get_meta("Employee").get_fieldnames()
	# 					if "custom_member" in employee_fields:
	# 						employee_list = frappe.get_all(
	# 							"Employee",
	# 							filters={"custom_member": self.traveler_name},
	# 							fields=["name"],
	# 							limit=1
	# 						)
	# 						if employee_list:
	# 							employee = employee_list[0].name
	# 				except Exception:
	# 					pass
			
	# 		# If no employee found, use default employee (Administrator)
	# 		if not employee:
	# 			# Try to get Administrator employee first
	# 			try:
	# 				admin_employee = frappe.db.get_value("Employee", {"user_id": "Administrator"}, "name")
	# 				if admin_employee:
	# 					employee = admin_employee
	# 				else:
	# 					# If Administrator employee doesn't exist, get any active employee
	# 					employee_list = frappe.get_all(
	# 						"Employee",
	# 						filters={"status": "Active"},
	# 						fields=["name"],
	# 						limit=1
	# 					)
	# 					if employee_list:
	# 						employee = employee_list[0].name
	# 					else:
	# 						# Last resort: get any employee
	# 						employee_list = frappe.get_all(
	# 							"Employee",
	# 							fields=["name"],
	# 							limit=1
	# 						)
	# 						if employee_list:
	# 							employee = employee_list[0].name
	# 			except Exception:
	# 				pass
			
	# 		# If still no employee found, throw error
	# 		if not employee:
	# 			frappe.throw(_("Could not find an Employee. Please create at least one Employee in the system."))
			
	# 		# Create Expense Claim
	# 		expense_claim = frappe.get_doc({
	# 			"doctype": "Expense Claim",
	# 			"employee": employee,
	# 			"company": self.company,
	# 			"expense_claim_date": self.posting_date,
	# 			"custom_traveller_name": self.traveler_name,
	# 			"custom_travel_group": self.travel_group,
	# 			"custom_is_addition": self.is_addition,
	# 			"company_group": self.company_group,
	# 			"branch": self.branch,
	# 			"marka": self.marka,
	# 			"cost_center": self.cost_center,
	# 			"project": self.project,
	# 			"payable_account": self.payable_account if not self.is_paid else None,
	# 			"is_paid": self.is_paid if hasattr(self, 'is_paid') else 0,
	# 			"direct_payment_account": self.direct_payment_account if (hasattr(self, 'is_paid') and self.is_paid and hasattr(self, 'direct_payment_account')) else None,
	# 			# Copy travel details
	# 			"custom_flight_no": self.flight_no,
	# 			"custom_departure_airport": self.custom_departure_airport,
	# 			"custom_arrival_airport": self.custom_arrival_airport,
	# 			"custom_airlines": self.custom_airlines,
	# 			"custom_date_of_travel": self.custom_date_of_travel,
	# 			"custom_date_of_arrival": self.custom_date_of_arrival,
	# 			"custom_date_of_purchase": self.custom_date_of_purchase,
	# 			"custom_booked_by": self.custom_booked_by,
	# 			"custom_travel_type": self.custom_travel_type,
	# 			"custom_pnr_number_": self.custom_pnr_number_,
	# 		})
			
	# 		# Add expenses from child table
	# 		if self.expenses:
	# 			for expense_row in self.expenses:
	# 				# Expense Claim uses company currency, so use amount_company_currency if available
	# 				# Otherwise use amount (which might be in transaction currency)
	# 				expense_amount = getattr(expense_row, 'amount_company_currency', None) or expense_row.amount or 0
					
	# 				# Sanctioned amount should not exceed amount
	# 				# Use amount_company_currency for sanctioned_amount if available, otherwise use amount
	# 				sanctioned_amount_value = getattr(expense_row, 'sanctioned_amount', None)
	# 				if sanctioned_amount_value:
	# 					# If sanctioned_amount is set, ensure it doesn't exceed amount
	# 					sanctioned_amount_value = min(flt(sanctioned_amount_value), flt(expense_amount))
	# 				else:
	# 					# If not set, use the same as amount
	# 					sanctioned_amount_value = expense_amount
					
	# 				expense_detail = {
	# 					"expense_type": expense_row.expense_type,
	# 					"expense_date": expense_row.expense_date,
	# 					"amount": expense_amount,
	# 					"sanctioned_amount": sanctioned_amount_value,
	# 					"description": expense_row.description,
	# 					"cost_center": expense_row.cost_center or self.cost_center,
	# 					"project": expense_row.project or self.project,
	# 					# Hotel fields
	# 					"hotel_checkin_date": expense_row.hotel_checkin_date,
	# 					"hotel_checkout_date": expense_row.hotel_checkout_date,
	# 					"custom_hotel_name": expense_row.custom_hotel_name,
	# 					"hotel_territory": expense_row.hotel_territory,
	# 					"hotel_location": expense_row.hotel_location,
	# 					"hotel_city": expense_row.hotel_city,
	# 					"hotel_country": expense_row.hotel_country,
	# 					"purpose": expense_row.purpose,
	# 					"rate_per_day": expense_row.rate_per_day,
	# 					"total_nights": expense_row.get("total_nights"),
	# 					# Travel fields
	# 					"custom_prn_number": expense_row.custom_prn_number,
	# 					"custom_date_of_purchase": expense_row.custom_date_of_purchase,
	# 					"custom_travel_type": expense_row.custom_travel_type,
	# 					"custom_booked_by": expense_row.custom_booked_by,
	# 					"custom_departure_airport": expense_row.custom_departure_airport,
	# 					"custom_arrival_airport": expense_row.custom_arrival_airport,
	# 					"custom_airlines": expense_row.custom_airlines,
	# 					"custom_date_of_travel": expense_row.custom_date_of_travel,
	# 					"custom_date_of_arrival": expense_row.custom_date_of_arrival,
	# 				}
	# 				# Remove None values
	# 				expense_detail = {k: v for k, v in expense_detail.items() if v is not None}
	# 				expense_claim.append("expenses", expense_detail)
			
	# 		# Add taxes and charges if any
	# 		if self.taxes_and_charges:
	# 			for tax_row in self.taxes_and_charges:
	# 				expense_claim.append("taxes", {
	# 					"account_head": tax_row.account_head,
	# 					"rate": tax_row.rate,
	# 					"description": tax_row.description,
	# 					"tax_amount": tax_row.tax_amount,
	# 					"total": tax_row.total,
	# 					"cost_center": tax_row.cost_center or self.cost_center,
	# 				})
			
	# 		# Add advances if any
	# 		if self.advances:
	# 			for advance_row in self.advances:
	# 				expense_claim.append("advances", {
	# 					"employee_advance": advance_row.employee_advance,
	# 					"posting_date": advance_row.posting_date,
	# 					"advance_paid": advance_row.advance_paid,
	# 					"unclaimed_amount": advance_row.unclaimed_amount,
	# 					"allocated_amount": advance_row.allocated_amount,
	# 				})
			
	# 		# Insert expense claim first (before submitting)
	# 		expense_claim.insert(ignore_permissions=True)
	# 		frappe.db.commit()
			
	# 		# Get the expense claim name
	# 		expense_claim_name = expense_claim.name
			
	# 		# Submit the expense claim
	# 		expense_claim.submit()
	# 		frappe.db.commit()
			
	# 		frappe.msgprint(
	# 			_("Expense Claim {0} has been created and submitted.").format(
	# 				frappe.bold(expense_claim_name)
	# 			),
	# 			indicator="green",
	# 			alert=True
	# 		)
	# 		print("Huku ni noma", expense_claim_name)
	# 		# Return the expense claim name
	# 		return expense_claim_name
			
	# 	except Exception as e:
	# 		frappe.log_error(
	# 			f"Error creating Expense Claim from Travel Expense {self.name}: {str(e)}",
	# 			"Travel Expense Error"
	# 		)
	# 		frappe.throw(_("Error creating Expense Claim: {0}").format(str(e)))
		
	# 	# Return None if something went wrong
	# 	return None
   
