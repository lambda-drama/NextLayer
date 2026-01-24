import json

import frappe
from frappe.utils import fmt_money, now

from nextlayer.next_layer.api.whatsapp_utils import send_whatsapp_message


def _send_invoice_whatsapp(invoice_name=None, mobile_no=None, message=None, customer_name=None):
	"""
	Internal reusable function to send WhatsApp message with/without invoice.
	"""

	if not mobile_no:
		frappe.throw("Mobile number is required.")

	if not message:
		if invoice_name and customer_name:
			message = f"Hello {customer_name}, your invoice {invoice_name} is ready! Thank you for shopping with us."
		else:
			message = "Your invoice is ready! Thank you for shopping with us."

	try:
		if invoice_name:
			result = send_whatsapp_message(
				to_number=mobile_no,
				message_type="text",
				message_content=message,
				reference_doctype="Sales Invoice",
				reference_name=invoice_name,
				attach_document=True,
			)
		else:
			result = send_whatsapp_message(
				to_number=mobile_no,
				message_type="text",
				message_content=message,
			)

		if result.get("success"):
			return {
				"status": "success",
				"recipient": mobile_no,
				"message": message,
				"invoice": invoice_name,
				"customer_name": customer_name,
				"message_id": result.get("message_id"),
				"timestamp": now(),
			}
		else:
			frappe.throw(f"Failed to send WhatsApp message: {result.get('error')}")

	except Exception as e:
		frappe.log_error(frappe.get_traceback(), "Send WhatsApp Failed")
		frappe.throw(f"Failed to send WhatsApp message: {e!s}")


@frappe.whitelist()
def deliver_invoice_via_whatsapp(**kwargs):
	"""
	Called from frontend with data payload
	"""
	data = kwargs
	return _send_invoice_whatsapp(
		invoice_name=data.get("invoice_data"),
		mobile_no=data.get("mobile_no"),
		message=data.get("message"),
		customer_name=data.get("customer_name"),
	)


@frappe.whitelist()
def send_invoice_whatsapp(**kwargs):
	"""
	Accepts frontend payload and sends invoice WhatsApp message with PDF attachment.
	"""
	data = kwargs
	print("Invoice WhatsApp data", data)
	mobile = data.get("mobile_no")
	# customer_name is not used here; message_text may already include name
	invoice_no = data.get("invoice_data")
	message_text = data.get("message", "Your invoice is ready! NextLayer")

	if not (mobile and invoice_no):
		frappe.throw("Mobile number and invoice number are required.")

	try:
		doc = frappe.get_doc("Sales Invoice", invoice_no)

		# Format invoice amount
		invoice_amount = fmt_money(doc.rounded_total or doc.grand_total, currency=doc.currency)

		# Send WhatsApp message with document attachment using the utility function
		result = send_whatsapp_message(
			to_number=mobile,
			message_type="text",
			message_content=message_text,
			reference_doctype="Sales Invoice",
			reference_name=invoice_no,
			attach_document=True,
		)

		if result.get("success"):
			return {
				"status": "success",
				"recipient": mobile,
				"invoice": invoice_no,
				"amount": invoice_amount,
				"message_id": result.get("message_id"),
				"timestamp": now(),
			}
		else:
			frappe.throw(f"Failed to send WhatsApp message: {result.get('error')}")

	except Exception as e:
		frappe.log_error(frappe.get_traceback(), "Send Invoice WhatsApp Failed")
		frappe.throw(f"Failed to send WhatsApp message: {e!s}")


@frappe.whitelist()
def send_template_whatsapp(**kwargs):
	"""
	Send template WhatsApp message from frontend
	"""
	data = kwargs
	print("Template WhatsApp data", data)

	mobile = data.get("mobile_no")
	template_name = data.get("template_name")
	template_parameters = data.get("template_parameters")

	if not mobile:
		frappe.throw("Mobile number is required.")

	if not template_name:
		frappe.throw("Template name is required.")

	try:
		# Use the utility function from utils.py
		result = send_whatsapp_message(
			to_number=mobile,
			message_type="template",
			template_name=template_name,
			template_parameters=template_parameters,
		)

		if result.get("success"):
			return {
				"status": "success",
				"recipient": mobile,
				"template": template_name,
				"parameters": template_parameters,
				"message_id": result.get("message_id"),
				"timestamp": now(),
			}
		else:
			frappe.throw(f"Failed to send WhatsApp message: {result.get('error')}")

	except Exception as e:
		frappe.log_error(frappe.get_traceback(), "Send Template WhatsApp Failed")
		frappe.throw(f"Failed to send WhatsApp message: {e!s}")


@frappe.whitelist()
def deliver_invoice_via_whatsapp_doc(invoice_name, mobile_no=None, message=None):
	"""
	Called from Sales Invoice form button
	"""
	invoice = frappe.get_doc("Sales Invoice", invoice_name)
	customer = frappe.get_doc("Customer", invoice.customer)

	mobile = mobile_no or customer.mobile_no or invoice.contact_mobile
	customer_name = invoice.customer_name

	return _send_invoice_whatsapp(
		invoice_name=invoice.name,
		mobile_no=mobile,
		message=message,
		customer_name=customer_name,
	)


@frappe.whitelist()
def get_whatsapp_templates():
	"""
	Get all WhatsApp message templates
	"""
	try:
		templates = frappe.get_all(
			"WhatsApp Message Templates",
			filters={"status": "Approved"},
			fields=[
				"name",
				"template_name",
				"template",
				"actual_name",
				"status",
				"category",
				"language",
				"language_code",
				"header_type",
				"header",
				"footer",
				"sample_values",
				"field_names",
			],
		)
		return templates
	except Exception as e:
		frappe.log_error(frappe.get_traceback(), "Get WhatsApp Templates Failed")
		frappe.throw(f"Failed to get WhatsApp templates: {e!s}")


@frappe.whitelist()
def get_default_template_for_doctype(doctype):
	"""
	Get default WhatsApp template for a doctype from WhatsApp Setup
	"""
	try:
		setup = frappe.get_doc("WhatsApp Setup", "WhatsApp Setup")
		if setup.template_details:
			for row in setup.template_details:
				if row.reference_doctype == doctype:
					return row.whatsapp_template
		return None
	except Exception as e:
		frappe.log_error(frappe.get_traceback(), "Get Default Template Failed")
		return None


@frappe.whitelist()
def send_invoice_via_whatsapp_with_template(invoice_name, mobile_no, template_name=None, template_parameters=None, print_format="Standard", letter_head=None):
	"""
	Send Sales Invoice via WhatsApp with template support
	"""
	try:
		invoice = frappe.get_doc("Sales Invoice", invoice_name)
		
		# If template is provided, send template message
		if template_name:
			result = send_whatsapp_message(
				to_number=mobile_no,
				message_type="template",
				template_name=template_name,
				template_parameters=template_parameters,
				reference_doctype="Sales Invoice",
				reference_name=invoice_name,
				attach_document=True,
				print_format=print_format,
				letter_head=letter_head,
			)
		else:
			# Send text message with PDF
			customer_name = invoice.customer_name or invoice.customer
			message = f"Hello {customer_name}, your invoice {invoice_name} is ready! Thank you for shopping with us."
			
			result = send_whatsapp_message(
				to_number=mobile_no,
				message_type="text",
				message_content=message,
				reference_doctype="Sales Invoice",
				reference_name=invoice_name,
				attach_document=True,
				print_format=print_format,
				letter_head=letter_head,
			)
		
		if result.get("success"):
			return {
				"status": "success",
				"recipient": mobile_no,
				"invoice": invoice_name,
				"message_id": result.get("message_id"),
				"timestamp": now(),
			}
		else:
			frappe.throw(f"Failed to send WhatsApp message: {result.get('error')}")
			
	except Exception as e:
		frappe.log_error(frappe.get_traceback(), "Send Invoice WhatsApp Failed")
		frappe.throw(f"Failed to send WhatsApp message: {e!s}")


@frappe.whitelist()
def get_print_formats_for_doctype(doctype):
	"""
	Get all available print formats for a doctype
	"""
	try:
		print_formats = frappe.get_all(
			"Print Format",
			filters={"doc_type": doctype, "disabled": 0},
			fields=["name", "print_format_name"],
			order_by="name"
		)
		return [{"value": pf["name"], "label": pf["print_format_name"] or pf["name"]} for pf in print_formats]
	except Exception as e:
		frappe.log_error(frappe.get_traceback(), "Get Print Formats Failed")
		return []


@frappe.whitelist()
def get_invoice_pdf_preview_url(invoice_name, print_format="Standard", letter_head=None):
	"""
	Get PDF preview URL for Sales Invoice with specified print format and letter head
	"""
	try:
		invoice = frappe.get_doc("Sales Invoice", invoice_name)
		key = invoice.get_document_share_key()
		frappe.db.commit()
		
		from frappe.desk.form.utils import get_pdf_link
		site_url = frappe.utils.get_url()
		link = get_pdf_link("Sales Invoice", invoice_name, print_format=print_format)
		
		# Append letter head as URL parameter if provided
		if letter_head:
			separator = "&" if "?" in link else "?"
			link = f"{link}{separator}letterhead={letter_head}"
		
		return f"{site_url}{link}&key={key}"
	except Exception as e:
		frappe.log_error(frappe.get_traceback(), "Get Invoice PDF Preview Failed")
		frappe.throw(f"Failed to get PDF preview: {e!s}")


@frappe.whitelist()
def get_whatsapp_template(template_name):
	"""
	Get a specific WhatsApp template by name
	"""
	try:
		template = frappe.get_doc("WhatsApp Message Templates", template_name)
		return {
			"name": template.name,
			"template_name": template.template_name,
			"template": template.template,
			"status": template.status,
			"category": template.category,
			"language": template.language,
			"language_code": template.language_code,
			"header_type": template.header_type,
			"header": template.header,
			"footer": template.footer,
			"sample_values": template.sample_values,
			"field_names": template.field_names,
		}
	except Exception as e:
		frappe.log_error(frappe.get_traceback(), "Get WhatsApp Template Failed")
		frappe.throw(f"Failed to get WhatsApp template: {e!s}")


