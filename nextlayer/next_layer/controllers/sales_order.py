# Copyright (c) 2025, jr@gmail.com and contributors
# For license information, please see license.txt

import frappe


def before_save(doc, method=None):
	"""
	Before save hook for Sales Order.
	If custom_autocreate_payment_entry is ticked, set custom_paid_amount to rounded_total.
	"""
	if doc.get("custom_autocreate_payment_entry") and doc.get("rounded_total"):
		doc.custom_paid_amount = doc.rounded_total

