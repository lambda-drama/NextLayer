# Copyright (c) 2026, jr@gmail.com and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document


class Tenant(Document):
	pass


	@frappe.whitelist()
	def create_customer_for_tenant(tenant_name, email=None, phone=None):
		"""Create Customer from Tenant data and flag as tenant"""
		
		# Check if customer already exists
		existing_customer = frappe.db.get_value("Customer", {"customer_name": tenant_name})
		if existing_customer:
			# Update existing customer
			customer = frappe.get_doc("Customer", existing_customer)
			customer.customer_group = "Tenant"
			customer.custom_is_tenant = 1
			if email:
				customer.email_id = email
			if phone:
				customer.mobile_no = phone
			customer.save()
			return customer.name
		
		# Create new customer
		customer = frappe.get_doc({
			"doctype": "Customer",
			"customer_name": tenant_name,
			"customer_group": "Tenant",
			"customer_type": "Individual",
			"email_id": email,
			"mobile_no": phone,
			"custom_is_tenant": 1  # Custom field
		})
		customer.insert(ignore_permissions=True)
		
		return customer.name

	@frappe.whitelist()
	def create_tenant_from_customer(customer):
		"""Create Tenant record from existing Customer"""
		
		# Get customer details
		customer_doc = frappe.get_doc("Customer", customer)
		
		# Check if tenant already exists
		existing_tenant = frappe.db.get_value("Tenant", {"customer": customer})
		if existing_tenant:
			frappe.throw(_("Tenant record already exists for this customer: {0}").format(existing_tenant))
		
		# Create tenant
		tenant = frappe.get_doc({
			"doctype": "Tenant",
			"tenant_name": customer_doc.customer_name,
			"customer": customer_doc.name,
			"email": customer_doc.email_id,
			"phone": customer_doc.mobile_no,
			"status": "Active"
		})
		tenant.insert(ignore_permissions=True)
		
		# Flag customer as tenant
		customer_doc.custom_is_tenant = 1
		customer_doc.save()
		
		return tenant.name

	@frappe.whitelist()
	def sync_tenant_to_customer(tenant):
		"""Sync Tenant changes back to Customer"""
		
		tenant_doc = frappe.get_doc("Tenant", tenant)
		
		if tenant_doc.customer:
			customer = frappe.get_doc("Customer", tenant_doc.customer)
			customer.customer_name = tenant_doc.tenant_name
			customer.email_id = tenant_doc.email
			customer.mobile_no = tenant_doc.phone
			customer.custom_is_tenant = 1
			customer.save()
		
		return True
