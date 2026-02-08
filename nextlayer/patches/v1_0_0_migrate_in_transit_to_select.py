# Copyright (c) 2026, Next Layer and contributors
# Migrate in_transit from Check (0/1) to Select (""/"In Transit"/"Multi City")

import frappe


def execute():
	"""Migrate Travel Expense in_transit: 1 -> 'In Transit', 0/null -> ''"""
	# frappe.db.sql("""
	# 	UPDATE `tabTravel Expense`
	# 	SET in_transit = 'In Transit'
	# 	WHERE in_transit = '1' OR in_transit = 1
	# """)
	# frappe.db.sql("""
	# 	UPDATE `tabTravel Expense`
	# 	SET in_transit = ''
	# 	WHERE in_transit = '0' OR in_transit = 0 OR in_transit IS NULL
	# """)
	# frappe.db.commit()
	frappe.clear_cache()
