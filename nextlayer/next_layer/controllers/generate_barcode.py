# Copyright (c) 2025, jr@gmail.com and contributors
# For license information, please see license.txt

import frappe
import random
import re
from barcode import Code128
from barcode.writer import ImageWriter
from frappe.utils.file_manager import save_file


def sanitize_filename(filename):
	"""
	Remove special characters and replace spaces with underscores.
	"""
	filename = re.sub(r'[^\w\s.-]', '', filename)
	filename = filename.replace(" ", "_")
	return filename


@frappe.whitelist()
def generate_image_for_barcode(barcode):
	"""
	Generate a barcode image and save it in Frappe's file system.
	"""
	try:
		sanitized_filename = sanitize_filename(barcode)

		file_path = frappe.get_site_path(f"private/files/{sanitized_filename}.png")

		code = Code128(barcode, writer=ImageWriter())

		code.save(file_path.replace(".png", ""))

		with open(file_path, "rb") as f:
			file_doc = save_file(f"{sanitized_filename}.png", f.read(), "Item Barcode", barcode, is_private=1)
		return file_doc.file_url
	except Exception as e:
		frappe.log_error(f"Error generating barcode image: {str(e)}")
		return None


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

			# Generate barcode image
			barcode_image = generate_image_for_barcode(ean_barcode)

			# Create Item Barcode record
			barcode_doc = frappe.get_doc({
				"doctype": "Item Barcode",
				"parent": item.name,
				"parenttype": "Item",
				"parentfield": "barcodes",
				"barcode": ean_barcode,
				"barcode_type": "EAN",
				"custom_image": barcode_image
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


@frappe.whitelist()
def generate_barcode_for_item(item_code):
	"""Generate EAN barcode with image for a specific item"""
	try:
		# Check if item exists
		if not frappe.db.exists("Item", item_code):
			frappe.throw(f"Item {item_code} does not exist")

		# Check if item already has an EAN barcode
		existing_barcode = frappe.get_value("Item Barcode",
			{"parent": item_code, "barcode_type": "EAN"},
			"barcode"
		)

		if existing_barcode:
			return {
				"status": "skipped",
				"message": f"Item {item_code} already has an EAN barcode: {existing_barcode}"
			}

		# Generate EAN-13 barcode
		ean_barcode = generate_ean13_barcode()

		# Generate barcode image
		barcode_image = generate_image_for_barcode(ean_barcode)

		# Create Item Barcode record
		barcode_doc = frappe.get_doc({
			"doctype": "Item Barcode",
			"parent": item_code,
			"parenttype": "Item",
			"parentfield": "barcodes",
			"barcode": ean_barcode,
			"barcode_type": "EAN",
			"custom_image": barcode_image
		})

		barcode_doc.insert(ignore_permissions=True)
		# frappe.db.commit()

		return {
			"status": "success",
			"message": f"Generated EAN barcode {ean_barcode} for item {item_code}",
			"barcode": ean_barcode,
			"image": barcode_image
		}

	except Exception as e:
		frappe.log_error(f"Error generating barcode for item {item_code}: {str(e)}")
		frappe.db.rollback()
		return {
			"status": "error",
			"message": f"Failed to generate barcode for item {item_code}: {str(e)}"
		}


def auto_generate_barcode_for_item(doc, method):
	"""Automatically generate barcode for new items that maintain stock"""
	try:
		# Only generate barcode for items that maintain stock
		if not doc.is_stock_item:
			return

		# Check if item already has any barcode
		existing_barcodes = frappe.get_all("Item Barcode",
			filters={"parent": doc.name},
			fields=["barcode"]
		)

		if existing_barcodes:
			# Item already has barcodes, skip
			return

		# Generate EAN-13 barcode
		ean_barcode = generate_ean13_barcode()

		# Generate barcode image
		barcode_image = generate_image_for_barcode(ean_barcode)

		# Create Item Barcode record
		barcode_doc = frappe.get_doc({
			"doctype": "Item Barcode",
			"parent": doc.name,
			"parenttype": "Item",
			"parentfield": "barcodes",
			"barcode": ean_barcode,
			"barcode_type": "EAN",
			"custom_image": barcode_image
		})

		barcode_doc.insert(ignore_permissions=True)
		# frappe.db.commit()

	except Exception as e:
		frappe.log_error(f"Error auto-generating barcode for item {doc.name}: {str(e)}")
		# Don't raise the exception to avoid breaking item creation


@frappe.whitelist()
def get_item_barcodes(item_code):
	"""Get all barcodes for a specific item"""
	try:
		barcodes = frappe.get_all("Item Barcode",
			filters={"parent": item_code},
			fields=["barcode", "barcode_type", "custom_image"],
			order_by="creation desc"
		)

		return barcodes

	except Exception as e:
		frappe.log_error(f"Error getting barcodes for item {item_code}: {str(e)}")
		return []

