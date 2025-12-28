# Copyright (c) 2025, jr@gmail.com and contributors
# For license information, please see license.txt

import frappe
import os
from io import BytesIO
try:
	import qrcode
	QRCODE_AVAILABLE = True
except ImportError:
	QRCODE_AVAILABLE = False


def sanitize_filename(name):
	"""
	Sanitize filename by replacing special characters that could cause path issues.
	"""
	import re
	# Replace special characters with underscores
	safe_name = re.sub(r'[<>:"/\\|?*]', '_', name)
	# Replace spaces and other problematic characters
	safe_name = safe_name.replace(' ', '_').replace('#', '%23')
	return safe_name


def generate_qr_code_for_invoice(invoice_name, print_format_name):
	"""
	Generate QR code for sales invoice based on print format.
	
	For "General Trading QR Code": Contains link to download PDF
	For "General Trading Invoice": Contains invoice details (company, customer name, VAT, amount, net amount)
	"""
	if not QRCODE_AVAILABLE:
		frappe.log_error("qrcode library not available. Install with: pip install qrcode[pil]")
		return None
	
	try:
		# Get invoice document
		invoice = frappe.get_doc("Sales Invoice", invoice_name)
		
		# Determine QR code content based on print format
		if print_format_name == "General Trading QR Code":
			# QR code with PDF download link
			site_url = frappe.utils.get_url()
			# Generate share key for the document
			key = invoice.get_document_share_key()
			frappe.db.commit()
			# Create PDF download link - use the print format name in the URL
			qr_content = f"{site_url}/api/method/frappe.utils.print_format.download_pdf?doctype=Sales Invoice&name={invoice_name}&format={print_format_name}&key={key}"
		elif print_format_name == "General Trading Invoice":
			# QR code with invoice details in readable format
			company = invoice.company or ""
			customer_name = invoice.customer_name or ""
			
			# Get formatted currency values
			currency = invoice.currency or ""
			vat_amount = invoice.total_taxes_and_charges or 0
			grand_total = invoice.grand_total or 0
			net_total = invoice.net_total or 0
			
			# Format amounts with currency
			vat_formatted = frappe.format_value(vat_amount, {"fieldtype": "Currency", "currency": currency}, invoice) if vat_amount else f"0.00 {currency}"
			amount_formatted = frappe.format_value(grand_total, {"fieldtype": "Currency", "currency": currency}, invoice) if grand_total else f"0.00 {currency}"
			net_amount_formatted = frappe.format_value(net_total, {"fieldtype": "Currency", "currency": currency}, invoice) if net_total else f"0.00 {currency}"
			
			# Format as readable text
			qr_content = f"""INVOICE DETAILS
Company: {company}
Customer: {customer_name}
Net Amount: {net_amount_formatted}
VAT: {vat_formatted}
Total Amount: {amount_formatted}
Invoice No: {invoice_name}"""
		else:
			# Default: just invoice name
			qr_content = invoice_name
		
		# Generate QR code image
		qr = qrcode.QRCode(
			version=1,
			error_correction=qrcode.constants.ERROR_CORRECT_L,
			box_size=10,
			border=4,
		)
		qr.add_data(qr_content)
		qr.make(fit=True)
		
		# Create image
		img = qr.make_image(fill_color="black", back_color="white")
		
		# Save to BytesIO
		img_buffer = BytesIO()
		img.save(img_buffer, format='PNG')
		img_buffer.seek(0)
		
		# Save file as PNG to barcodes folder
		# Create barcodes folder if it doesn't exist
		barcodes_folder = frappe.get_site_path("public", "files", "barcodes")
		os.makedirs(barcodes_folder, exist_ok=True)
		
		# Make filename unique per print format to avoid overwriting
		# Sanitize invoice name to remove path characters
		format_suffix = sanitize_filename(print_format_name)
		safe_invoice_name = sanitize_filename(invoice_name)
		filename = f"QRCode_{format_suffix}_{safe_invoice_name}.png"
		file_path = os.path.join(barcodes_folder, filename)
		
		# Write file directly to barcodes folder
		with open(file_path, "wb") as f:
			f.write(img_buffer.read())
		
		# Create File record in Frappe
		file_url = f"/files/barcodes/{filename}"
		
		# Check if file record already exists
		existing_file = frappe.db.get_value("File", {
			"file_url": file_url,
			"attached_to_doctype": "Sales Invoice",
			"attached_to_name": invoice_name
		})
		
		if not existing_file:
			file_doc = frappe.get_doc({
				"doctype": "File",
				"file_name": filename,
				"file_url": file_url,
				"attached_to_doctype": "Sales Invoice",
				"attached_to_name": invoice_name,
				"is_private": 0
			})
			file_doc.insert(ignore_permissions=True)
			frappe.db.commit()

		return file_url
		
	except Exception as e:
		frappe.log_error(f"Error generating QR code for invoice {invoice_name}: {str(e)}")
		return None


@frappe.whitelist(allow_guest=True)
def get_invoice_qr_code_url(invoice_name, print_format_name):
	"""
	Get QR code URL for invoice, generating if it doesn't exist.
	This function is called from Jinja templates in print formats.
	"""
	try:
		# Make filename unique per print format
		# Sanitize invoice name to remove path characters
		format_suffix = sanitize_filename(print_format_name)
		safe_invoice_name = sanitize_filename(invoice_name)
		filename = f"QRCode_{format_suffix}_{safe_invoice_name}.png"
		file_url = f"/files/barcodes/{filename}"
		
		# Check if file exists in database
		existing_file = frappe.db.get_value("File", {
			"file_url": file_url,
			"attached_to_doctype": "Sales Invoice",
			"attached_to_name": invoice_name
		}, "file_url")
		
		if existing_file:
			return existing_file
		
		# Also check if file exists on disk
		file_path = frappe.get_site_path("public", "files", "barcodes", filename)
		if os.path.exists(file_path):
			return file_url
		
		# Generate new QR code
		return generate_qr_code_for_invoice(invoice_name, print_format_name)
		
	except Exception as e:
		# Log error but don't break PDF generation - return a fallback
		frappe.log_error(f"Error getting QR code URL for invoice {invoice_name}: {str(e)}")
		# Return a placeholder or empty string so the print format doesn't break
		return None

