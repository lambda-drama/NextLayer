# Copyright (c) 2025, Next Layer and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document
from frappe import _
from frappe.utils import flt

from frappe.utils import cint
from decimal import Decimal

class TravelExpense(Document):
	def validate(self):
		"""Calculate totals and sync multi-city to expenses when applicable"""
		self._sync_multi_city_to_expenses()
		self.calculate_totals()
		travel_expense_on_save(self)

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

def travel_expense_on_save(doc):
    """
    Hook: on_save
    Automatically divides expenses among travelers if conditions are met
    """
    
    # Check if we have traveler_name (Table MultiSelect)
    if not doc.traveler_name or len(doc.traveler_name) == 0:
        return
    
    # Get the list of members from traveller_name
    members_in_multiselect = [row.member for row in doc.traveler_name]
    number_of_travelers = len(members_in_multiselect)
    
    # Get current expense rows
    current_expenses = doc.expenses if hasattr(doc, 'expenses') else []
    number_of_expense_rows = len(current_expenses)
    
    # SKIP auto-division if:
    # 1. Number of travelers equals number of expense rows
    if number_of_expense_rows == number_of_travelers:
        # Check if all travelers are already represented in expense rows
        members_in_rows = [row.traveller_name for row in current_expenses if hasattr(row, 'traveller_name')]
        
        if all(member in members_in_rows for member in members_in_multiselect):
            frappe.msgprint(
                f"✓ Each of the {number_of_travelers} travelers is already assigned to expense rows. "
                "Skipping auto-division. You can manually adjust amounts as needed.",
                alert=True
            )
            return
    
    # 2. Skip if there are more expense rows than travelers (user already divided)
    if number_of_expense_rows >= number_of_travelers:
        frappe.msgprint(
            f"Note: Found {number_of_expense_rows} expense rows for {number_of_travelers} travelers. "
            "Not auto-dividing. You can adjust amounts manually.",
            alert=True
        )
        return
    
    # AUTO-DIVIDE: If we have fewer expense rows than travelers
    if number_of_expense_rows > 0 and number_of_travelers > number_of_expense_rows:
        frappe.msgprint(
            f"Auto-dividing {number_of_expense_rows} expense row(s) among {number_of_travelers} travelers...",
            alert=True
        )
        
        # Get the first (source) row
        source_row = current_expenses[0]
        
        # Calculate divided amount (for currency fields)
        original_amount = Decimal(str(source_row.amount or 0))
        original_amount_company = Decimal(str(source_row.amount_company_currency or 0))
        
        divided_amount = original_amount / number_of_travelers
        divided_amount_company = original_amount_company / number_of_travelers
        
        # Clear existing rows (we'll rebuild from scratch)
        doc.expenses = []
        
        # Create one row per traveler
        for idx, member in enumerate(members_in_multiselect):
            expense_row = frappe.new_doc('Travel Expense Detail')
            
            # Copy all fields from source row
            expense_row.expense_type = source_row.expense_type
            expense_row.expense_date = source_row.expense_date
            expense_row.description = source_row.description
            
            expense_row.traveller_name = member
            
            expense_row.amount = float(divided_amount)
            expense_row.amount_company_currency = float(divided_amount_company)
            
            if hasattr(source_row, 'sanctioned_amount') and source_row.sanctioned_amount:
                expense_row.sanctioned_amount = float(Decimal(str(source_row.sanctioned_amount)) / number_of_travelers)
            
            # Copy hotel-related fields if present
            if hasattr(source_row, 'hotel_checkin_date'):
                expense_row.hotel_checkin_date = source_row.hotel_checkin_date
            if hasattr(source_row, 'hotel_checkout_date'):
                expense_row.hotel_checkout_date = source_row.hotel_checkout_date
            if hasattr(source_row, 'custom_hotel_name'):
                expense_row.custom_hotel_name = source_row.custom_hotel_name
            if hasattr(source_row, 'hotel_territory'):
                expense_row.hotel_territory = source_row.hotel_territory
            if hasattr(source_row, 'hotel_location'):
                expense_row.hotel_location = source_row.hotel_location
            if hasattr(source_row, 'rate_per_day'):
                expense_row.rate_per_day = source_row.rate_per_day
            if hasattr(source_row, 'hotel_city'):
                expense_row.hotel_city = source_row.hotel_city
            if hasattr(source_row, 'hotel_country'):
                expense_row.hotel_country = source_row.hotel_country
            if hasattr(source_row, 'purpose'):
                expense_row.purpose = source_row.purpose
            
            # Copy travel-related fields if present
            if hasattr(source_row, 'custom_prn_number'):
                expense_row.custom_prn_number = source_row.custom_prn_number
            if hasattr(source_row, 'custom_date_of_purchase'):
                expense_row.custom_date_of_purchase = source_row.custom_date_of_purchase
            if hasattr(source_row, 'custom_travel_type'):
                expense_row.custom_travel_type = source_row.custom_travel_type
            if hasattr(source_row, 'custom_booked_by'):
                expense_row.custom_booked_by = source_row.custom_booked_by
            if hasattr(source_row, 'custom_departure_airport'):
                expense_row.custom_departure_airport = source_row.custom_departure_airport
            if hasattr(source_row, 'custom_arrival_airport'):
                expense_row.custom_arrival_airport = source_row.custom_arrival_airport
            if hasattr(source_row, 'custom_airlines'):
                expense_row.custom_airlines = source_row.custom_airlines
            if hasattr(source_row, 'custom_date_of_travel'):
                expense_row.custom_date_of_travel = source_row.custom_date_of_travel
            if hasattr(source_row, 'custom_date_of_arrival'):
                expense_row.custom_date_of_arrival = source_row.custom_date_of_arrival
            
            if hasattr(source_row, 'cost_center'):
                expense_row.cost_center = source_row.cost_center
            if hasattr(source_row, 'project'):
                expense_row.project = source_row.project
            
            doc.append('expenses', expense_row)
        
        frappe.msgprint(
            f"✓ Successfully created {number_of_travelers} expense rows (one per traveler) with divided amounts.",
            alert=True
        )
