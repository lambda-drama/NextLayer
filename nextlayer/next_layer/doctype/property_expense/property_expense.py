# Copyright (c) 2026, jr@gmail.com and contributors
# For license information, please see license.txt

# import frappe
import frappe
from frappe.model.document import Document
from frappe.utils import nowdate, flt

class PropertyExpense(Document):
    
    def validate(self):
        self.total_amount = flt(self.amount) + flt(self.tax)
    
    @frappe.whitelist()
    def create_journal_entry(self):
        """Create a Journal Entry for this expense"""
        
        if self.journal_entry:
            frappe.throw("Journal Entry already exists for this expense.")
        
        # Get expense account from Unit
        unit = frappe.get_doc("Unit", self.unit)
        expense_account = unit.expense_account
        
        if not expense_account:
            frappe.throw(f"No expense account configured on Unit {self.unit}")
        
        # Determine credit account based on bill_to
        credit_account = self.get_credit_account()
        
        # Create Journal Entry
        je = frappe.get_doc({
            "doctype": "Journal Entry",
            "voucher_type": "Journal Entry",
            "posting_date": self.expense_date or nowdate(),
            "company": self.company,
            "remark": f"Expense for {self.expense_type} - {self.description or self.unit}",
            "accounts": [
                {
                    "account": expense_account,
                    "debit_in_account_currency": self.total_amount,
                    "credit_in_account_currency": 0,
                    "party_type": self.get_party_type(),
                    "party": self.get_party(),
                    "cost_center": unit.cost_center if unit else None
                },
                {
                    "account": credit_account,
                    "debit_in_account_currency": 0,
                    "credit_in_account_currency": self.total_amount,
                    "party_type": self.get_credit_party_type(),
                    "party": self.get_credit_party()
                }
            ]
        })
        
        je.insert()
        je.submit()
        
        # Update expense record
        self.journal_entry = je.name
        self.is_accounted = 1
        self.save()
        
        return je.name
    
    def get_credit_account(self):
        """Get credit account based on bill_to"""
        unit = frappe.get_doc("Unit", self.unit)
        
        if self.bill_to == "Owner":
            return unit.owner_liability_account or "Accounts Payable - Company"
        elif self.bill_to == "Tenant":
            return unit.tenant_deposit_liability_account or "Security Deposit Liability - Company"
        elif self.bill_to == "Property Management":
            return unit.pm_expense_account or "Operating Expenses - Company"
        else:
            return "Accounts Payable - Company"
    
    def get_party_type(self):
        """Get party type for debit"""
        if self.bill_to == "Owner":
            return "Customer"
        elif self.bill_to == "Tenant":
            return "Customer"
        return None
    
    def get_party(self):
        """Get party for debit"""
        if self.bill_to == "Owner":
            return self.owner
        elif self.bill_to == "Tenant":
            return self.tenant
        return None
    
    def get_credit_party_type(self):
        """Get party type for credit"""
        if self.bill_to == "Supplier":
            return "Supplier"
        return None
    
    def get_credit_party(self):
        """Get party for credit"""
        if self.bill_to == "Supplier":
            return self.supplier
        return None
