# Copyright (c) 2026, jr@gmail.com and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document
from frappe.utils import nowdate, flt, getdate

class PropertyExpense(Document):
    
    def validate(self):
        self.total_amount = flt(self.amount) + flt(self.tax)
        
        # Auto-set company from unit if not set
        if self.unit and not self.company:
            unit = frappe.get_doc("Unit", self.unit)
            self.company = unit.company
    
    @frappe.whitelist()
    def create_journal_entry(self):
        """Create a Journal Entry for this expense"""
        
        # if self.journal_entry:
        #     frappe.throw("Journal Entry already exists for this expense.")
        
        if self.docstatus != 1:
            frappe.throw("Expense must be submitted before creating journal entry.")
        
        # Get Unit with all accounting fields
        unit = frappe.get_doc("Unit", self.unit)
        
        # Get expense account from Unit
        expense_account = unit.expense_account
        if not expense_account:
            frappe.throw(f"No expense account configured on Unit {self.unit}")
        
        # Get cost center from Unit
        cost_center = self.cost_center
        
        # Determine credit account based on bill_to
        credit_account = self._get_credit_account(unit)
        
        # Prepare Journal Entry accounts
        accounts = []
        
        # Debit account (Expense)
        debit_entry = {
            "account": expense_account,
            "debit_in_account_currency": self.total_amount,
            "credit_in_account_currency": 0,
            "party_type": self._get_debit_party_type(),
            "party": self._get_debit_party(),
        }
        if cost_center:
            debit_entry["cost_center"] = cost_center
        accounts.append(debit_entry)
        
        # Credit account (Liability/Payable)
        credit_entry = {
            "account": credit_account,
            "debit_in_account_currency": 0,
            "credit_in_account_currency": self.total_amount,
            "party_type": self._get_credit_party_type(),
            "party": self._get_credit_party(),
        }
        accounts.append(credit_entry)
        
        # Create Journal Entry
        je = frappe.get_doc({
            "doctype": "Journal Entry",
            "voucher_type": "Journal Entry",
            "posting_date": self.expense_date or getdate(nowdate()),
            "company": self.company or unit.company,
            "remark": f"Expense: {self.expense_type} - {self.description or self.unit}",
            "accounts": accounts
        })
        
        je.insert()
        je.submit()
        
        # Update expense record
        # self.db_set("journal_entry", je.name)
        self.db_set("is_accounted", 1)
        
        frappe.msgprint(f"Journal Entry {je.name} created successfully")
        
        return je.name
    
    @frappe.whitelist()
    def create_tenant_invoice(self):
        """Create Sales Invoice to charge tenant for this expense"""
        
        if self.sales_invoice:
            frappe.throw("Sales Invoice already exists for this expense.")
        
        if self.bill_to != "Tenant":
            frappe.throw("This expense is not billed to a tenant.")
        
        if not self.tenant:
            frappe.throw("No tenant selected.")
        
        if self.docstatus != 1:
            frappe.throw("Expense must be submitted before creating invoice.")
        
        # Get active contract for this unit
        contract = frappe.db.get_value(
            "Tenant Contract",
            {"unit": self.unit, "status": "Active", "docstatus": 1},
            ["name", "company", "currency"],
            as_dict=True
        )
        
        if not contract:
            frappe.throw(f"No active contract found for unit {self.unit}")
        
        # Get customer from tenant
        customer = frappe.db.get_value("Tenant", self.tenant, "customer")
        if not customer:
            frappe.throw(f"Tenant {self.tenant} has no linked customer.")
        
        # Create Sales Invoice
        from frappe.utils import add_days
        
        invoice = frappe.get_doc({
            "doctype": "Sales Invoice",
            "customer": customer,
            "company": contract.company,
            "posting_date": nowdate(),
            "due_date": add_days(nowdate(), 15),
            "currency": contract.currency,
            "custom_unit": self.unit,
            "items": [{
                "item_code": "MAINTENANCE-CHARGE",
                "item_name": f"Expense: {self.expense_type}",
                "qty": 1,
                "rate": self.total_amount,
                "description": self.description or f"{self.expense_type} - {self.bill_number or ''}"
            }],
            "remarks": f"Expense from Property Expense {self.name}"
        })
        
        invoice.insert()
        invoice.submit()
        
        # Update expense record
        self.db_set("sales_invoice", invoice.name)
        
        frappe.msgprint(f"Sales Invoice {invoice.name} created successfully")
        
        return invoice.name
    
    # ─────────────────────────────────────────────────────────────────────────
    #  Private helpers
    # ─────────────────────────────────────────────────────────────────────────
    
    def _get_credit_account(self, unit):
        """Get credit account based on bill_to"""
        if self.bill_to == "Owner":
            return unit.owner_liability_account or "Accounts Payable - Company"
        elif self.bill_to == "Tenant":
            return unit.tenant_deposit_liability_account or "Security Deposit Liability - Company"
        elif self.bill_to == "Property Management":
            return unit.pm_expense_account or "Operating Expenses - Company"
        else:
            return "Accounts Payable - Company"
    
    def _get_debit_party_type(self):
        """Get party type for debit side"""
        if self.bill_to == "Owner":
            return "Customer"
        elif self.bill_to == "Tenant":
            return "Customer"
        return None
    
    def _get_debit_party(self):
        """Get party for debit side"""
        if self.bill_to == "Owner":
            return self.owner
        elif self.bill_to == "Tenant":
            return self.tenant
        return None
    
    def _get_credit_party_type(self):
        """Get party type for credit side"""
        if self.bill_to == "Supplier":
            return "Supplier"
        return None
    
    def _get_credit_party(self):
        """Get party for credit side"""
        if self.bill_to == "Supplier":
            return self.supplier
        return None