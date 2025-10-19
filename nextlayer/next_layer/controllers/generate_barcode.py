# Copyright (c) 2025, jr@gmail.com and contributors
# For license information, please see license.txt

import frappe
import random


@frappe.whitelist()
def generate_ean_barcodes_for_items(company):
	"""Generate EAN barcodes for all items and add them to Item Barcode child table"""
	try:
		# Get all items
		items = frappe.get_all("Item",
			filters={"disabled": 0},
			fields=["name", "item_code", "item_name"]
		)

		generated_count = 0
		skipped_count = 0

		for item in items:
			# Check if item already has an EAN barcode
			existing_barcode = frappe.get_value("Item Barcode",
				{"parent": item.name, "barcode_type": "EAN"},
				"barcode"
			)

			if existing_barcode:
				skipped_count += 1
				continue

			# Generate EAN-13 barcode
			ean_barcode = generate_ean13_barcode()

			# Create Item Barcode record
			barcode_doc = frappe.get_doc({
				"doctype": "Item Barcode",
				"parent": item.name,
				"parenttype": "Item",
				"parentfield": "barcodes",
				"barcode": ean_barcode,
				"barcode_type": "EAN"
			})

			barcode_doc.insert(ignore_permissions=True)
			generated_count += 1

		# Commit the transaction
		frappe.db.commit()

		return {
			"generated_count": generated_count,
			"skipped_count": skipped_count,
			"total_items": len(items)
		}

	except Exception as e:
		frappe.log_error(f"Error generating EAN barcodes: {str(e)}")
		frappe.db.rollback()
		raise e


def generate_ean13_barcode():
	"""Generate a valid EAN-13 barcode"""
	# EAN-13 format: 12 digits + 1 check digit
	# We'll use a company prefix (first 3 digits) and generate the rest

	# Generate first 12 digits
	prefix = "200"  # Company prefix (you can customize this)
	base_number = prefix + ''.join([str(random.randint(0, 9)) for _ in range(9)])

	# Calculate check digit
	check_digit = calculate_ean13_check_digit(base_number)

	# Return complete EAN-13 barcode
	return base_number + str(check_digit)


def calculate_ean13_check_digit(number):
	"""Calculate the check digit for EAN-13 barcode"""
	# EAN-13 check digit calculation
	# Sum of odd positions + 3 * sum of even positions
	# Then modulo 10, subtract from 10

	total = 0
	for i, digit in enumerate(number):
		position = i + 1  # 1-based position
		if position % 2 == 1:  # Odd position
			total += int(digit)
		else:  # Even position
			total += 3 * int(digit)

	check_digit = (10 - (total % 10)) % 10
	return check_digit

