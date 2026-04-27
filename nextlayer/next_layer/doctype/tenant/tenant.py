# Copyright (c) 2026, jr@gmail.com and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document

class Tenant(Document):
	
	def before_save(self):
		"""Auto-create customer before saving if not linked"""
		if not self.customer:
			self.customer = self.create_customer_for_tenant()
	
	def after_save(self):
		"""Sync to customer after save"""
		if self.customer:
			self.sync_to_customer()
	
	@frappe.whitelist()
	def create_customer_for_tenant(self):
		"""Create Customer from Tenant data"""
		
		# Check if customer with same name exists
		existing_customer = frappe.db.get_value("Customer", 
			{"customer_name": self.tenant_name})
		
		if existing_customer:
			# Update existing customer
			customer = frappe.get_doc("Customer", existing_customer)
			customer.customer_group = "Tenant"
			customer.custom_is_tenant = 1
			customer.email_id = self.email
			customer.mobile_no = self.mobile_no
			customer.save()
			return customer.name
		
		# Create new customer
		customer = frappe.get_doc({
			"doctype": "Customer",
			"customer_name": self.tenant_name,
			"customer_group": "Tenant",
			"customer_type": "Individual",
			"email_id": self.email,
			"mobile_no": self.mobile_no,
			"custom_is_tenant": 1
		})
		customer.insert()
		return customer.name
	
	def sync_to_customer(self):
		"""Sync Tenant data to Customer"""
		if not self.customer:
			return
		
		customer = frappe.get_doc("Customer", self.customer)
		customer.customer_name = self.tenant_name
		customer.email_id = self.email
		customer.mobile_no = self.mobile_no
		customer.save()
	
	@frappe.whitelist()
	def create_customer_for_tenant(self):
		"""Create Customer from Tenant data"""
		
		# Ensure Tenant customer group exists
		if not frappe.db.exists("Customer Group", "Tenant"):
			customer_group = frappe.get_doc({
				"doctype": "Customer Group",
				"customer_group_name": "Tenant",
				"parent_customer_group": "All Customer Groups",
				"is_group": 0
			})
			customer_group.insert()
		
		# Check if customer with same name exists
		existing_customer = frappe.db.get_value("Customer", 
			{"customer_name": self.tenant_name})
		
		if existing_customer:
			# Update existing customer
			customer = frappe.get_doc("Customer", existing_customer)
			customer.customer_group = "Tenant"
			customer.custom_is_tenant = 1
			customer.email_id = self.email
			customer.mobile_no = self.mobile_no
			customer.save()
			return customer.name
		
		# Create new customer
		customer = frappe.get_doc({
			"doctype": "Customer",
			"customer_name": self.tenant_name,
			"customer_group": "Tenant",
			"customer_type": "Individual",
			"email_id": self.email,
			"mobile_no": self.mobile_no,
			"custom_is_tenant": 1
		})
		customer.insert()
		
		return customer.name