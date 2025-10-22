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
			filters={"disabled": 0, "is_stock_item": 1},
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
				# custom_image will be generated on-demand when printing
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


@frappe.whitelist()
def enqueue_generate_ean_barcodes_for_items(company):
	"""Enqueue the generation of EAN barcodes for all items to run in background"""
	try:
		# Get total count of items for progress tracking
		total_items = frappe.db.count("Item", filters={"disabled": 0, "is_stock_item": 1})

		if total_items == 0:
			return {
				"status": "info",
				"message": "No items found to generate barcodes for"
			}

		# Enqueue the background job
		job = frappe.enqueue(
			method="nextlayer.next_layer.controllers.generate_barcode.generate_ean_barcodes_for_items_background",
			queue="long",
			timeout=300,  # 1 hour timeout
			company=company,
			job_name=f"Generate EAN Barcodes for {company}",
			enqueue_after_commit=True
		)

		return {
			"status": "success",
			"message": f"Barcode generation job queued successfully. Processing {total_items} items.",
			"job_id": job.id if job else None,
			"total_items": total_items
		}

	except Exception as e:
		frappe.log_error(f"Error enqueueing EAN barcode generation: {str(e)}")
		return {
			"status": "error",
			"message": f"Failed to queue barcode generation: {str(e)}"
		}


def generate_ean_barcodes_for_items_background(company):
	"""Background function to generate EAN barcodes for all items"""
	try:
		# Get all items
		items = frappe.get_all("Item",
			filters={"disabled": 0, "is_stock_item": 1},
			fields=["name", "item_code", "item_name"]
		)

		generated_count = 0
		skipped_count = 0
		error_count = 0

		frappe.log_error(f"Starting background barcode generation for {len(items)} items")

		for i, item in enumerate(items):
			try:
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

				# Create Item Barcode record (image will be generated on-demand)
				barcode_doc = frappe.get_doc({
					"doctype": "Item Barcode",
					"parent": item.name,
					"parenttype": "Item",
					"parentfield": "barcodes",
					"barcode": ean_barcode,
					"barcode_type": "EAN"
					# custom_image will be generated on-demand when printing
				})

				barcode_doc.insert(ignore_permissions=True)
				generated_count += 1

				# Commit every 10 items to avoid long transactions
				if (i + 1) % 10 == 0:
					frappe.db.commit()
					frappe.log_error(f"Processed {i + 1}/{len(items)} items. Generated: {generated_count}, Skipped: {skipped_count}")

			except Exception as item_error:
				error_count += 1
				frappe.log_error(f"Error processing item {item.name}: {str(item_error)}")
				continue

		# Final commit
		frappe.db.commit()

		# Log final results
		frappe.log_error(f"Barcode generation completed. Generated: {generated_count}, Skipped: {skipped_count}, Errors: {error_count}")

		return {
			"generated_count": generated_count,
			"skipped_count": skipped_count,
			"error_count": error_count,
			"total_items": len(items)
		}

	except Exception as e:
		frappe.log_error(f"Error in background barcode generation: {str(e)}")
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
			fields=["name", "barcode", "barcode_type", "custom_image"],
			order_by="creation desc"
		)

		return barcodes

	except Exception as e:
		frappe.log_error(f"Error getting barcodes for item {item_code}: {str(e)}")
		return []


@frappe.whitelist()
def generate_and_save_barcode_image(barcode_id):
	"""Generate and save barcode image for a specific Item Barcode record"""
	try:
		# Get the barcode record
		barcode_doc = frappe.get_doc("Item Barcode", barcode_id)

		if not barcode_doc.barcode:
			frappe.throw("No barcode found for this record")

		# Check if image already exists
		if barcode_doc.custom_image:
			return {
				"status": "success",
				"message": "Barcode image already exists",
				"image_url": barcode_doc.custom_image
			}

		# Generate barcode image
		barcode_image = generate_image_for_barcode(barcode_doc.barcode)
		print("Ites here",str(barcode_image))
		if barcode_image:
			# Update the record with the image
			barcode_doc.custom_image = barcode_image
			barcode_doc.save(ignore_permissions=True)

			return {
				"status": "success",
				"message": "Barcode image generated and saved",
				"image_url": barcode_image
			}
		else:
			return {
				"status": "error",
				"message": "Failed to generate barcode image"
			}

	except Exception as e:
		frappe.log_error(f"Error generating barcode image for {barcode_id}: {str(e)}")
		return {
			"status": "error",
			"message": f"Failed to generate barcode image: {str(e)}"
		}


@frappe.whitelist()
def print_barcodes_for_items(item_codes=None, company=None):
	"""Print barcodes for specified items, generating images on-demand if needed"""
	try:
		if not item_codes:
			# If no specific items, get all items with barcodes
			items_with_barcodes = frappe.get_all("Item Barcode",
				filters={"parenttype": "Item"},
				fields=["parent", "name", "barcode", "custom_image"],
				group_by="parent"
			)
		else:
			# Get barcodes for specific items
			items_with_barcodes = frappe.get_all("Item Barcode",
				filters={"parent": ["in", item_codes]},
				fields=["parent", "name", "barcode", "custom_image"]
			)

		if not items_with_barcodes:
			return {
				"status": "info",
				"message": "No items with barcodes found"
			}

		generated_images = 0
		existing_images = 0
		errors = 0

		for item_barcode in items_with_barcodes:
			try:
				if not item_barcode.custom_image:
					# Generate image on-demand
					result = generate_and_save_barcode_image(item_barcode.name)
					if result.get("status") == "success":
						generated_images += 1
					else:
						errors += 1
				else:
					existing_images += 1

			except Exception as e:
				errors += 1
				frappe.log_error(f"Error processing barcode for item {item_barcode.parent}: {str(e)}")

		# Get updated barcodes with images for printing
		updated_barcodes = frappe.get_all("Item Barcode",
			filters={"parent": ["in", [item["parent"] for item in items_with_barcodes]]},
			fields=["parent", "barcode", "custom_image", "barcode_type"],
			order_by="parent"
		)

		return {
			"status": "success",
			"message": f"Ready for printing. Generated: {generated_images}, Existing: {existing_images}, Errors: {errors}",
			"barcodes": updated_barcodes,
			"generated_images": generated_images,
			"existing_images": existing_images,
			"errors": errors
		}

	except Exception as e:
		frappe.log_error(f"Error in print_barcodes_for_items: {str(e)}")
		return {
			"status": "error",
			"message": f"Failed to prepare barcodes for printing: {str(e)}"
		}


@frappe.whitelist()
def get_printable_barcodes(item_code=None):
	"""Get barcodes ready for printing (with images)"""
	try:
		filters = {"parenttype": "Item"}
		if item_code:
			filters["parent"] = item_code

		barcodes = frappe.get_all("Item Barcode",
			filters=filters,
			fields=["parent", "barcode", "custom_image", "barcode_type"],
			order_by="parent"
		)

		# Filter only barcodes that have images
		printable_barcodes = [barcode for barcode in barcodes if barcode.custom_image]

		return {
			"status": "success",
			"barcodes": printable_barcodes,
			"count": len(printable_barcodes)
		}

	except Exception as e:
		frappe.log_error(f"Error getting printable barcodes: {str(e)}")
		return {
			"status": "error",
			"message": f"Failed to get printable barcodes: {str(e)}"
		}

