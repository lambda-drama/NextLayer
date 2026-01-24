"""
WhatsApp Utility Functions for NextLayer
Standalone functions for sending WhatsApp messages from both backend and frontend
"""

import json

import frappe
from frappe import _
from frappe.desk.form.utils import get_pdf_link
from frappe.integrations.utils import make_post_request
from frappe.utils import get_url


@frappe.whitelist()
def send_whatsapp_from_chat(chat_name):
	"""
	Send WhatsApp message from an existing WhatsApp Chat document
	
	Args:
		chat_name (str): Name of the WhatsApp Chat document
	
	Returns:
		dict: Response with success status and message details
	"""
	try:
		chat_doc = frappe.get_doc("WhatsApp Chat", chat_name)
		
		# Validate that this is an outgoing message
		if chat_doc.type != "Outgoing":
			return {"success": False, "error": "Can only send outgoing messages"}
		
		# Validate required fields
		if not chat_doc.to:
			return {"success": False, "error": "Recipient phone number (TO) is required"}
		
		# Get WhatsApp settings
		settings = frappe.get_doc("WhatsApp Setup", "WhatsApp Setup")
		if not settings.enabled:
			return {"success": False, "error": "WhatsApp is not enabled"}

		token = settings.get_password("token")
		if not token:
			return {"success": False, "error": "WhatsApp token not configured"}

		# Format phone number
		formatted_number = format_phone_number(chat_doc.to)
		
		# Prepare message data based on type
		if chat_doc.use_template and chat_doc.template:
			if not chat_doc.template:
				return {"success": False, "error": "Template is required when using template"}
			
			# Get template details
			template = frappe.get_doc("WhatsApp Message Templates", chat_doc.template)
			
			# Parse template parameters if provided
			template_parameters = None
			if chat_doc.template_parameters:
				try:
					template_parameters = json.loads(chat_doc.template_parameters)
				except:
					template_parameters = [chat_doc.template_parameters]
			
			# Build template message data
			data = {
				"messaging_product": "whatsapp",
				"to": formatted_number,
				"type": "template",
				"template": {
					"name": template.actual_name or template.template_name,
					"language": {"code": template.language_code},
					"components": [],
				},
			}
			
			# Add reply context if this is a reply (Note: Templates typically don't support replies, but we'll add it if needed)
			# WhatsApp API doesn't support replying with templates, so we skip context for templates
			
			# Add body parameters if provided
			if template_parameters:
				parameters = []
				for param in template_parameters:
					param_text = str(param).strip()
					if param_text:
						parameters.append({"type": "text", "text": param_text})
				
				if parameters:
					data["template"]["components"].append({"type": "body", "parameters": parameters})
			
			# Handle attachments
			if chat_doc.attach:
				url = get_custom_attachment_url(chat_doc.attach)
				if url:
					data["template"]["components"].append({
						"type": "header",
						"parameters": [{
							"type": "document",
							"document": {
								"link": url,
								"filename": chat_doc.attach.split("/").pop() or "attachment.pdf",
							},
						}],
					})
			
			# Make API call
			result = make_whatsapp_api_call(
				data,
				settings,
				token,
				chat_doc.reference_doctype,
				chat_doc.reference_name,
				"Template",
				chat_doc.template,
				template_parameters,
				update_existing_chat=chat_doc  # Pass existing chat doc to update instead of creating new
			)
		else:
			if not chat_doc.message:
				return {"success": False, "error": "Message content is required"}
			
			# Build text message data
			data = {
				"messaging_product": "whatsapp",
				"to": formatted_number,
				"type": "text",
				"text": {"preview_url": True, "body": chat_doc.message},
			}
			
			# Add reply context if this is a reply
			if chat_doc.is_reply and chat_doc.reply_to_message_id:
				data["context"] = {
					"message_id": chat_doc.reply_to_message_id
				}
			
			# Handle document attachment
			if chat_doc.attach:
				url = get_custom_attachment_url(chat_doc.attach)
				if url:
					data = {
						"messaging_product": "whatsapp",
						"to": formatted_number,
						"type": "document",
						"document": {
							"link": url,
							"filename": chat_doc.attach.split("/").pop() or "document.pdf",
							"caption": chat_doc.message,
						},
					}
					# Add reply context for document messages too
					if chat_doc.is_reply and chat_doc.reply_to_message_id:
						data["context"] = {
							"message_id": chat_doc.reply_to_message_id
						}
			
			# Make API call
			result = make_whatsapp_api_call(
				data,
				settings,
				token,
				chat_doc.reference_doctype,
				chat_doc.reference_name,
				"Manual",
				None,
				None,
				update_existing_chat=chat_doc  # Pass existing chat doc to update instead of creating new
			)
		
		# Update the chat document with results
		if result.get("success"):
			chat_doc.message_id = result.get("message_id")
			chat_doc.status = "Success"
			chat_doc.save(ignore_permissions=True)
			frappe.db.commit()
		else:
			chat_doc.status = "Failed"
			chat_doc.save(ignore_permissions=True)
			frappe.db.commit()
		
		return result
		
	except Exception as e:
		frappe.log_error(f"Error sending WhatsApp from chat: {str(e)}\nTraceback: {frappe.get_traceback()}", "WhatsApp Send from Chat")
		return {"success": False, "error": str(e)}


@frappe.whitelist()
def send_whatsapp_message(
	to_number,
	message_type="text",
	message_content=None,
	template_name=None,
	template_parameters=None,
	reference_doctype=None,
	reference_name=None,
	attach_document=False,
	custom_attachment=None,
	file_name=None,
):
	"""
	Standalone function to send WhatsApp messages

	Args:
	    to_number (str): Phone number with country code (e.g., "1234567890")
	    message_type (str): "text" or "template"
	    message_content (str): Text message content (for text messages)
	    template_name (str): Template name from WhatsApp Message Templates
	    template_parameters (list): List of parameters for template
	    reference_doctype (str): Reference doctype name
	    reference_name (str): Reference document name
	    attach_document (bool): Whether to attach document PDF
	    custom_attachment (str): Custom file URL or path
	    file_name (str): Name for the attachment

	Returns:
	    dict: Response with success status and message details
	"""
	try:
		# Get WhatsApp settings
		settings = frappe.get_doc("WhatsApp Setup", "WhatsApp Setup")
		if not settings.enabled:
			return {"success": False, "error": "WhatsApp is not enabled"}

		token = settings.get_password("token")
		if not token:
			return {"success": False, "error": "WhatsApp token not configured"}

		# Format phone number
		formatted_number = format_phone_number(to_number)

		if message_type == "text":
			return send_text_message(
				formatted_number,
				message_content,
				settings,
				token,
				reference_doctype,
				reference_name,
				attach_document,
			)
		elif message_type == "template":
			return send_template_message(
				formatted_number,
				template_name,
				template_parameters,
				settings,
				token,
				reference_doctype,
				reference_name,
				attach_document,
				custom_attachment,
				file_name,
			)
		else:
			return {
				"success": False,
				"error": f"Unsupported message type: {message_type}",
			}

	except Exception as e:
		frappe.log_error(f"WhatsApp Message Error: {e!s}", "WhatsApp Messaging")
		return {"success": False, "error": f"{e!s}"}


def send_text_message(
	to_number,
	message_content,
	settings,
	token,
	reference_doctype=None,
	reference_name=None,
	attach_document=False,
):
	"""Send a simple text message with optional document attachment"""

	# If we need to attach a document, we need to send as a document message
	if attach_document and reference_doctype and reference_name:
		# Get document URL
		document_url = get_document_attachment_url(reference_doctype, reference_name)

		if document_url:
			data = {
				"messaging_product": "whatsapp",
				"to": to_number,
				"type": "document",
				"document": {
					"link": document_url,
					"filename": "REPC-SRET-000001_PDFA3.pdf",
					"caption": message_content,
				},
			}
		else:
			# Fallback to text message with PDF generation instructions
			enhanced_message = f"{message_content}\n\n📄 PDF Generation: Your invoice PDF is ready but cannot be sent via WhatsApp in development mode. Please contact support to get your PDF."
			data = {
				"messaging_product": "whatsapp",
				"to": to_number,
				"type": "text",
				"text": {"preview_url": True, "body": enhanced_message},
			}
	else:
		# Regular text message
		data = {
			"messaging_product": "whatsapp",
			"to": to_number,
			"type": "text",
			"text": {"preview_url": True, "body": message_content},
		}

	# Log the exact request being sent
	# frappe.logger().debug(f"Text message request data: {json.dumps(data, indent=2)}")
	# frappe.logger().debug(f"Phone number: {to_number}")
	# frappe.logger().debug(f"Message content: {message_content}")
	# frappe.logger().debug(f"Attach document: {attach_document}")
	# frappe.logger().debug(f"Document URL: {document_url if attach_document and reference_doctype and reference_name else 'N/A'}")

	return make_whatsapp_api_call(data, settings, token, reference_doctype, reference_name, "Manual")


def send_template_message(
	to_number,
	template_name,
	template_parameters,
	settings,
	token,
	reference_doctype=None,
	reference_name=None,
	attach_document=False,
	custom_attachment=None,
	file_name=None,
):
	"""Send a template message"""
	# Get template details
	template = frappe.get_doc("WhatsApp Message Templates", template_name)

	# Validate template parameters
	if template_parameters:
		# Ensure template_parameters is a list
		if isinstance(template_parameters, str):
			try:
				template_parameters = json.loads(template_parameters)
			except Exception:
				template_parameters = [template_parameters]

		# Validate each parameter
		validated_parameters = []
		for _i, param in enumerate(template_parameters):
			if param is not None:
				validated_parameters.append(str(param).strip())
			else:
				validated_parameters.append("")

		template_parameters = validated_parameters

		# Log the parameters for debugging
		# frappe.logger().debug(f"Template parameters: {template_parameters}")
		# frappe.logger().debug(f"Template field names: {template.field_names}")
		# frappe.logger().debug(f"Template sample values: {template.sample_values}")

	data = {
		"messaging_product": "whatsapp",
		"to": to_number,
		"type": "template",
		"template": {
			"name": template.actual_name or template.template_name,
			"language": {"code": template.language_code},
			"components": [],
		},
	}

	# Add body parameters if provided
	if template_parameters:
		parameters = []
		for param in template_parameters:
			# Ensure parameter is a string and not split into characters
			param_text = str(param).strip()
			if param_text:  # Only add non-empty parameters
				parameters.append({"type": "text", "text": param_text})

		if parameters:  # Only add components if we have parameters
			data["template"]["components"].append({"type": "body", "parameters": parameters})

	# Handle attachments
	if attach_document and reference_doctype and reference_name:
		url = get_document_attachment_url(reference_doctype, reference_name)
		if url:
			data["template"]["components"].append(
				{
					"type": "header",
					"parameters": [
						{
							"type": "document",
							"document": {
								"link": url,
								"filename": f"{reference_name}.pdf",
							},
						}
					],
				}
			)
	elif custom_attachment:
		url = get_custom_attachment_url(custom_attachment)
		if url:
			data["template"]["components"].append(
				{
					"type": "header",
					"parameters": [
						{
							"type": "document",
							"document": {
								"link": url,
								"filename": file_name or "attachment.pdf",
							},
						}
					],
				}
			)

	return make_whatsapp_api_call(
		data,
		settings,
		token,
		reference_doctype,
		reference_name,
		"Template",
		template_name,
		template_parameters,
	)


def make_whatsapp_api_call(
	data,
	settings,
	token,
	reference_doctype=None,
	reference_name=None,
	message_type="Manual",
	template_name=None,
	template_parameters=None,
	update_existing_chat=None,  # Optional: WhatsApp Chat document to update instead of creating new
):
	"""Make the actual API call to WhatsApp"""
	headers = {"authorization": f"Bearer {token}", "content-type": "application/json"}

	try:
		# Validate required settings
		if not settings.url:
			return {"success": False, "error": "WhatsApp URL is not configured"}
		if not settings.version:
			return {"success": False, "error": "WhatsApp API version is not configured"}
		if not settings.phone_id:
			return {"success": False, "error": "WhatsApp Phone ID is not configured"}
		if not token:
			return {"success": False, "error": "WhatsApp token is not configured"}

		# Validate phone number format
		if not data.get("to") or not data["to"].isdigit():
			return {
				"success": False,
				"error": f"Invalid phone number format: {data.get('to')}. Must be digits only (without +)",
			}

		# Make the API call with better error handling
		try:
			response = make_post_request(
				f"{settings.url}/{settings.version}/{settings.phone_id}/messages",
				headers=headers,
				data=json.dumps(data),
			)
		except Exception as api_error:
			# Capture the actual response if available
			actual_response_text = "Unknown"
			actual_status_code = "Unknown"

			# Try to get response details from the exception
			if hasattr(api_error, 'response') and api_error.response:
				try:
					actual_response_text = api_error.response.text
					actual_status_code = api_error.response.status_code
				except:
					pass

			# Re-raise with more context
			raise Exception(f"API Error: {str(api_error)} | Status: {actual_status_code} | Response: {actual_response_text}")

		frappe.logger().debug(f"WhatsApp API Response: {json.dumps(response, indent=2)}")

		# If updating existing chat document, update it instead of creating new
		if update_existing_chat:
			chat_doc = update_existing_chat
			chat_doc.message_type = message_type
			chat_doc.content_type = data.get("type", "text")
			
			if message_type == "Template":
				chat_doc.template = template_name
				chat_doc.use_template = 1
				if template_parameters:
					chat_doc.template_parameters = json.dumps(template_parameters)
				chat_doc.message = str(data.get("template", ""))
			elif data.get("type") == "document":
				chat_doc.content_type = "document"
				chat_doc.message = data.get("document", {}).get("caption", "Document sent")
			else:
				chat_doc.message = data.get("text", {}).get("body", "")

			if "messages" in response:
				chat_doc.message_id = response["messages"][0]["id"]
			
			# Don't save here - let the caller save after checking success
			return {
				"success": True,
				"message_id": response.get("messages", [{}])[0].get("id"),
				"whatsapp_message_name": chat_doc.name,
			}
		else:
			# Create new WhatsApp message record (original behavior)
			message_doc = frappe.new_doc("WhatsApp Chat")
			message_doc.type = "Outgoing"
			message_doc.to = data["to"]
			message_doc.message_type = message_type
			message_doc.content_type = "text"
			message_doc.status = "Success"

			if message_type == "Template":
				message_doc.template = template_name
				message_doc.use_template = 1
				if template_parameters:
					message_doc.template_parameters = json.dumps(template_parameters)
				message_doc.message = str(data["template"])
			elif data.get("type") == "document":
				# Handle document messages
				message_doc.content_type = "document"
				message_doc.message = data["document"].get("caption", "Document sent")
			else:
				message_doc.message = data["text"]["body"]

			if reference_doctype and reference_name:
				message_doc.reference_doctype = reference_doctype
				message_doc.reference_name = reference_name

			if "messages" in response:
				message_doc.message_id = response["messages"][0]["id"]

			message_doc.insert(ignore_permissions=True)

			return {
				"success": True,
				"message_id": response.get("messages", [{}])[0].get("id"),
				"whatsapp_message_name": message_doc.name,
			}

	except Exception as e:
		error_message = str(e)
		error_details = {}
		response_text = "Unknown"
		status_code = "Unknown"

		# Try to get detailed error information
		if frappe.flags.integration_request:
			try:
				status_code = getattr(frappe.flags.integration_request, 'status_code', 'Unknown')
				response_text = getattr(frappe.flags.integration_request, 'text', 'Unknown')

				# Try to parse JSON response
				if response_text and response_text != "Unknown":
					try:
						error_response = json.loads(response_text)
						error_details = error_response
						if "error" in error_response:
							error_message = error_response["error"].get(
								"message", error_response["error"].get("Error", error_message)
							)
							# Add more specific error details
							if "error" in error_response and "error_subcode" in error_response["error"]:
								error_details["error_subcode"] = error_response["error"]["error_subcode"]
							if "error" in error_response and "fbtrace_id" in error_response["error"]:
								error_details["fbtrace_id"] = error_response["error"]["fbtrace_id"]
					except json.JSONDecodeError:
						error_details = {"raw_response": response_text}
			except Exception:
				pass

		# Enhanced error analysis
		diagnosis = analyze_whatsapp_error(error_message, status_code, error_details, data)

		# Log detailed error information
		frappe.log_error(
			f"WhatsApp API Error Details:\n"
			f"Error: {error_message}\n"
			f"Status Code: {status_code}\n"
			f"URL: {settings.url}/{settings.version}/{settings.phone_id}/messages\n"
			f"Data: {json.dumps(data, indent=2)}\n"
			f"Error Details: {json.dumps(error_details, indent=2)}\n"
			f"Response Text: {response_text}\n"
			f"Diagnosis: {json.dumps(diagnosis, indent=2)}",
			"WhatsApp Messaging",
		)

		return {
			"success": False,
			"error": error_message,
			"error_details": error_details,
			"diagnosis": diagnosis,
			"status_code": status_code,
			"response_text": response_text,
		}


def analyze_whatsapp_error(error_message, status_code, error_details, request_data):
	"""Analyze WhatsApp API errors and provide specific diagnosis"""
	diagnosis = {
		"likely_cause": "Unknown",
		"suggestions": [],
		"error_type": "Unknown"
	}

	# Check for specific error patterns
	if status_code == 400:
		diagnosis["error_type"] = "Bad Request"

		# Check error subcode if available
		if error_details.get("error", {}).get("error_subcode"):
			subcode = error_details["error"]["error_subcode"]

			if subcode == 132000:
				diagnosis["likely_cause"] = "Recipient phone number not verified"
				diagnosis["suggestions"] = [
					"The recipient phone number needs to be verified in WhatsApp Business Manager",
					"Make sure the phone number is correct and active",
					"Try sending to a different verified number first"
				]
			elif subcode == 131047:
				diagnosis["likely_cause"] = "Business account not verified"
				diagnosis["suggestions"] = [
					"Your WhatsApp Business account needs to be verified",
					"Complete the business verification process in WhatsApp Business Manager",
					"Ensure your business profile is complete"
				]
			elif subcode == 131051:
				diagnosis["likely_cause"] = "Phone number not associated with business account"
				diagnosis["suggestions"] = [
					"The phone number is not linked to your WhatsApp Business account",
					"Verify the phone number in WhatsApp Business Manager",
					"Check if the phone number is the correct one for your business"
				]
			elif subcode == 131026:
				diagnosis["likely_cause"] = "Message template not approved"
				diagnosis["suggestions"] = [
					"Use only approved message templates",
					"Wait for template approval before sending",
					"Check template status in WhatsApp Business Manager"
				]

		# Check for common error messages
		elif "recipient" in error_message.lower():
			diagnosis["likely_cause"] = "Recipient issue"
			diagnosis["suggestions"] = [
				"Recipient phone number may not be verified",
				"Recipient may have blocked your business number",
				"Try sending to a different number"
			]
		elif "business" in error_message.lower():
			diagnosis["likely_cause"] = "Business account issue"
			diagnosis["suggestions"] = [
				"Business account may not be fully verified",
				"Check business verification status",
				"Ensure all required business information is complete"
			]
		elif "template" in error_message.lower():
			diagnosis["likely_cause"] = "Template issue"
			diagnosis["suggestions"] = [
				"Template may not be approved",
				"Check template parameters",
				"Verify template exists and is active"
			]
		else:
			diagnosis["likely_cause"] = "General API configuration issue"
			diagnosis["suggestions"] = [
				"Check all API credentials are correct",
				"Verify phone number ID is correct",
				"Ensure access token has required permissions",
				"Check if you're using the correct API version"
			]

	elif status_code == 401:
		diagnosis["error_type"] = "Unauthorized"
		diagnosis["likely_cause"] = "Authentication failed"
		diagnosis["suggestions"] = [
			"Access token may be expired or invalid",
			"Regenerate the access token in WhatsApp Business Manager",
			"Check token permissions include messaging"
		]

	elif status_code == 403:
		diagnosis["error_type"] = "Forbidden"
		diagnosis["likely_cause"] = "Insufficient permissions"
		diagnosis["suggestions"] = [
			"Business account may not be approved for messaging",
			"Check account permissions in WhatsApp Business Manager",
			"Ensure phone number is verified"
		]

	return diagnosis


def format_phone_number(number):
	"""Format phone number for WhatsApp API"""
	if number.startswith("+"):
		number = number[1:]
	return number


def get_document_attachment_url(doctype, docname):
	"""Get PDF attachment URL for a document"""
	try:
		site_url = frappe.utils.get_url()
		# For testing purposes, use the static PDF URL
		if doctype == "Sales Invoice":
			pdf_ = generate_and_attach_invoice_pdf(docname)

			# # Check if we're using a local URL
			if "127.0.0.1" in site_url or "localhost" in site_url:
				frappe.logger().warning(f"Local URL detected: {site_url}. Using static cloud PDF.")
				return "https://clik-pos.k.frappe.cloud/files/REPC-SRET-000001_PDFA3%20(14).pdf"

			return pdf_

		doc = frappe.get_doc(doctype, docname)
		key = doc.get_document_share_key()
		frappe.db.commit()

		print_format = "Standard"
		doctype_meta = frappe.get_doc("DocType", doctype)
		if doctype_meta.custom:
			if doctype_meta.default_print_format:
				print_format = doctype_meta.default_print_format
		else:
			default_print_format = frappe.db.get_value(
				"Property Setter",
				filters={"doc_type": doctype, "property": "default_print_format"},
				fieldname="value",
			)
			print_format = default_print_format if default_print_format else print_format

		link = get_pdf_link(doctype, docname, print_format=print_format)
		site_url = frappe.utils.get_url()

		# Check if we're using a local URL
		if "127.0.0.1" in site_url or "localhost" in site_url:
			frappe.logger().warning(
				f"Local URL detected: {site_url}. Document sharing may not work with WhatsApp API."
			)
			return None

		return f"{site_url}{link}&key={key}"
	except Exception as e:
		frappe.log_error(f"Error getting document attachment URL: {e!s}", "WhatsApp Messaging")
		return None


def get_custom_attachment_url(attachment_path):
	"""Get URL for custom attachment"""
	if attachment_path.startswith("http"):
		return attachment_path
	else:
		return f"{frappe.utils.get_url()}{attachment_path}"


# Frontend-friendly wrapper functions
@frappe.whitelist()
def send_whatsapp_text(to_number, message_content, reference_doctype=None, reference_name=None):
	"""Whitelisted function for sending text messages from frontend"""
	return send_whatsapp_message(
		to_number=to_number,
		message_type="text",
		message_content=message_content,
		reference_doctype=reference_doctype,
		reference_name=reference_name,
	)


@frappe.whitelist()
def send_whatsapp_template(
	to_number,
	template_name,
	template_parameters=None,
	reference_doctype=None,
	reference_name=None,
):
	"""Whitelisted function for sending template messages from frontend"""
	if template_parameters and isinstance(template_parameters, str):
		template_parameters = json.loads(template_parameters)

	return send_whatsapp_message(
		to_number=to_number,
		message_type="template",
		template_name=template_name,
		template_parameters=template_parameters,
		reference_doctype=reference_doctype,
		reference_name=reference_name,
	)


@frappe.whitelist()
def get_whatsapp_templates():
	"""Get list of available WhatsApp templates"""
	templates = frappe.get_all(
		"WhatsApp Message Templates",
		filters={"status": "Approved"},
		fields=["name", "template_name", "actual_name", "category", "language"],
	)
	return templates


@frappe.whitelist()
def test_whatsapp_connection():
	"""Test WhatsApp API connection"""
	try:
		settings = frappe.get_doc("WhatsApp Setup", "WhatsApp Setup")
		token = settings.get_password("token")

		if not all([settings.enabled, token, settings.url, settings.version, settings.phone_id]):
			return {
				"success": False,
				"error": "All WhatsApp settings must be configured before testing",
			}

		# Test with a simple request to get phone number info
		headers = {
			"authorization": f"Bearer {token}",
			"content-type": "application/json",
		}

		test_url = f"{settings.url}/{settings.version}/{settings.phone_id}"

		response = frappe.integrations.utils.make_get_request(test_url, headers=headers)

		return {
			"success": True,
			"message": "WhatsApp API connection successful",
			"phone_info": response,
		}

	except Exception as e:
		error_message = str(e)
		if frappe.flags.integration_request:
			try:
				error_response = frappe.flags.integration_request.json()
				error_message = error_response.get("error", {}).get("message", error_message)
			except Exception:
				pass

		return {"success": False, "error": f"Connection test failed: {error_message}"}


@frappe.whitelist()
def troubleshoot_whatsapp_error(error_message):
	"""
	Troubleshoot common WhatsApp API errors and provide solutions

	Args:
	    error_message (str): The error message from the API

	Returns:
	    dict: Troubleshooting information and solutions
	"""
	common_errors = {
		"400": {
			"title": "Bad Request (400)",
			"description": "The request was malformed or contains invalid parameters",
			"common_causes": [
				"Invalid phone number format",
				"Missing required parameters",
				"Invalid template name",
				"Template not approved",
				"Invalid API version",
				"Incorrect phone ID",
			],
			"solutions": [
				"Ensure phone number is in international format without + (e.g., 1234567890)",
				"Verify all required template parameters are provided",
				"Check that template name matches exactly with approved template",
				"Ensure template is approved in WhatsApp Business Manager",
				"Verify API version is correct (usually v17.0 or v18.0)",
				"Confirm phone ID is correct and active",
			],
		},
		"401": {
			"title": "Unauthorized (401)",
			"description": "Authentication failed",
			"common_causes": [
				"Invalid access token",
				"Token expired",
				"Incorrect token format",
			],
			"solutions": [
				"Regenerate access token in WhatsApp Business Manager",
				"Ensure token is copied correctly without extra spaces",
				"Check token permissions include messaging",
			],
		},
		"403": {
			"title": "Forbidden (403)",
			"description": "Access denied",
			"common_causes": [
				"Insufficient permissions",
				"Phone number not verified",
				"Business account not approved",
			],
			"solutions": [
				"Verify business account is approved",
				"Ensure phone number is verified",
				"Check account permissions",
			],
		},
		"404": {
			"title": "Not Found (404)",
			"description": "Resource not found",
			"common_causes": [
				"Invalid phone ID",
				"Template not found",
				"Incorrect API endpoint",
			],
			"solutions": [
				"Verify phone ID is correct",
				"Check template name spelling",
				"Ensure API URL is correct",
			],
		},
	}

	# Extract error code from message
	error_code = None
	for code in common_errors.keys():
		if code in error_message:
			error_code = code
			break

	if error_code and error_code in common_errors:
		return {
			"error_code": error_code,
			"troubleshooting": common_errors[error_code],
			"raw_error": error_message,
		}
	else:
		return {
			"error_code": "unknown",
			"troubleshooting": {
				"title": "Unknown Error",
				"description": "This error is not in our common error database",
				"common_causes": ["Unknown API error"],
				"solutions": [
					"Check WhatsApp Business Manager for detailed error information",
					"Verify all settings are correct",
					"Contact WhatsApp support if issue persists",
				],
			},
			"raw_error": error_message,
		}


@frappe.whitelist()
def validate_phone_number_format(phone_number):
	"""
	Validate and format phone number for WhatsApp API

	Args:
	    phone_number (str): Phone number to validate

	Returns:
	    dict: Validation result and formatted number
	"""
	try:
		# Remove all non-digit characters
		cleaned = "".join(filter(str.isdigit, phone_number))

		# Validation rules
		if len(cleaned) < 10:
			return {
				"valid": False,
				"error": "Phone number too short (minimum 10 digits)",
			}

		if len(cleaned) > 15:
			return {
				"valid": False,
				"error": "Phone number too long (maximum 15 digits)",
			}

		# Check if it starts with country code
		if len(cleaned) == 10:
			return {
				"valid": False,
				"error": "Phone number should include country code (e.g., 1 for US, 44 for UK)",
			}

		return {
			"valid": True,
			"formatted": cleaned,
			"original": phone_number,
			"length": len(cleaned),
		}

	except Exception as e:
		return {"valid": False, "error": f"Validation error: {e!s}"}


@frappe.whitelist()
def get_whatsapp_template_status(template_name):
	"""
	Check the status of a WhatsApp template

	Args:
	    template_name (str): Name of the template to check

	Returns:
	    dict: Template status information
	"""
	try:
		template = frappe.get_doc("WhatsApp Message Templates", template_name)

		return {
			"name": template.name,
			"template_name": template.template_name,
			"actual_name": template.actual_name,
			"status": template.status,
			"language_code": template.language_code,
			"category": template.category,
			"field_names": template.field_names,
			"sample_values": template.sample_values,
			"is_approved": template.status == "Approved",
			"can_send": template.status == "Approved",
		}

	except Exception as e:
		return {
			"error": f"Template not found or error:{e!s}",
			"template_name": template_name,
		}


@frappe.whitelist()
def send_bulk_whatsapp_messages(
	recipients,
	message_type="text",
	message_content=None,
	template_name=None,
	template_parameters=None,
):
	"""
	Send WhatsApp messages to multiple recipients

	Args:
	    recipients (list): List of phone numbers
	    message_type (str): "text" or "template"
	    message_content (str): Text message content
	    template_name (str): Template name
	    template_parameters (list): Template parameters

	Returns:
	    dict: Results for each recipient
	"""
	if isinstance(recipients, str):
		recipients = json.loads(recipients)

	if isinstance(template_parameters, str):
		template_parameters = json.loads(template_parameters)

	results = []

	for recipient in recipients:
		result = send_whatsapp_message(
			to_number=recipient,
			message_type=message_type,
			message_content=message_content,
			template_name=template_name,
			template_parameters=template_parameters,
		)

		results.append(
			{
				"recipient": recipient,
				"success": result.get("success"),
				"error": result.get("error"),
				"message_id": result.get("message_id"),
			}
		)

	return {
		"total_sent": len([r for r in results if r.get("success")]),
		"total_failed": len([r for r in results if not r.get("success")]),
		"results": results,
	}


@frappe.whitelist()
def test_invoice_with_pdf(phone_number, invoice_no, message="Your invoice is ready! Maniac"):
	"""
	Test sending invoice with PDF attachment

	Args:
	    phone_number (str): Phone number to send to
	    invoice_no (str): Invoice number
	    message (str): Message to send with the PDF

	Returns:
	    dict: Test result with detailed debugging info
	"""
	try:
		# Get settings
		settings = frappe.get_doc("WhatsApp Setup", "WhatsApp Setup")
		token = settings.get_password("token")

		# Format phone number
		formatted_number = format_phone_number(phone_number)

		# Get document URL
		document_url = get_document_attachment_url("Sales Invoice", invoice_no)

		if not document_url:
			# Send text message instead with PDF generation notice
			data = {
				"messaging_product": "whatsapp",
				"to": formatted_number,
				"type": "text",
				"text": {
					"preview_url": True,
					"body": f"{message}\n\n📄 PDF Generation: Your invoice PDF is ready but cannot be sent via WhatsApp in development mode. Please contact support to get your PDF.",
				},
			}
		else:
			# Prepare the request data for document message
			data = {
				"messaging_product": "whatsapp",
				"to": formatted_number,
				"type": "document",
				"document": {
					"link": document_url,
					"filename": "REPC-SRET-000001_PDFA3.pdf",
					"caption": message,
				},
			}

		headers = {
			"authorization": f"Bearer {token}",
			"content-type": "application/json",
		}

		# Log the exact request that will be sent
		request_url = f"{settings.url}/{settings.version}/{settings.phone_id}/messages"
		request_data = json.dumps(data, indent=2)

		# Make the actual request
		response = frappe.integrations.utils.make_post_request(
			request_url, headers=headers, data=request_data
		)

		return {
			"success": True,
			"message": "Invoice PDF test successful",
			"request_url": request_url,
			"request_data": data,
			"response": response,
			"phone_number": formatted_number,
			"invoice_no": invoice_no,
			"document_url": document_url,
			"message_content": message,
		}

	except Exception as e:
		error_message = str(e)
		error_details = {}

		if frappe.flags.integration_request:
			try:
				error_response = frappe.flags.integration_request.json()
				error_details = error_response
				if "error" in error_response:
					error_message = error_response["error"].get(
						"message", error_response["error"].get("Error", error_message)
					)
			except Exception:
				pass

		return {
			"success": False,
			"error": error_message,
			"error_details": error_details,
			"request_url": request_url if "request_url" in locals() else None,
			"request_data": data if "data" in locals() else None,
			"phone_number": (formatted_number if "formatted_number" in locals() else None),
			"invoice_no": invoice_no,
			"document_url": document_url if "document_url" in locals() else None,
			"message_content": message,
		}


@frappe.whitelist()
def test_whatsapp_direct_api_call(phone_number="254740743521", message="Direct API test"):
	"""
	Test WhatsApp API with direct requests call to get actual error response
	"""
	import requests

	try:
		settings = frappe.get_doc("WhatsApp Setup", "WhatsApp Setup")
		token = settings.get_password("token")

		# Prepare the request
		url = f"{settings.url}/{settings.version}/{settings.phone_id}/messages"
		headers = {
			"authorization": f"Bearer {token}",
			"content-type": "application/json"
		}

		data = {
			"messaging_product": "whatsapp",
			"to": phone_number,
			"type": "text",
			"text": {
				"preview_url": True,
				"body": message
			}
		}

		# Make direct API call
		response = requests.post(url, headers=headers, json=data)

		result = {
			"status_code": response.status_code,
			"response_text": response.text,
			"response_headers": dict(response.headers),
			"request_url": url,
			"request_data": data,
			"success": response.status_code == 200
		}

		# Try to parse JSON response
		try:
			result["response_json"] = response.json()
		except:
			result["response_json"] = None

		# If error, provide specific diagnosis
		if response.status_code != 200:
			result["error_analysis"] = analyze_whatsapp_response_error(response.status_code, response.text, data)

		return result

	except Exception as e:
		return {
			"error": str(e),
			"success": False,
			"message": "Direct API call failed"
		}


def analyze_whatsapp_response_error(status_code, response_text, request_data):
	"""Analyze the actual WhatsApp API response error"""
	analysis = {
		"status_code": status_code,
		"response_text": response_text,
		"likely_causes": [],
		"solutions": []
	}

	try:
		# Try to parse the error response
		import json
		error_data = json.loads(response_text)

		if "error" in error_data:
			error = error_data["error"]
			analysis["error_code"] = error.get("code")
			analysis["error_subcode"] = error.get("error_subcode")
			analysis["error_message"] = error.get("message")
			analysis["error_type"] = error.get("type")

			# Specific error analysis
			if error.get("error_subcode") == 132000:
				analysis["likely_causes"].append("Recipient phone number not verified")
				analysis["solutions"].append("Recipient must have WhatsApp and be verified")
			elif error.get("error_subcode") == 131047:
				analysis["likely_causes"].append("Business account not verified")
				analysis["solutions"].append("Complete business verification in WhatsApp Business Manager")
			elif error.get("error_subcode") == 131051:
				analysis["likely_causes"].append("Phone number not associated with business account")
				analysis["solutions"].append("Verify Phone ID matches your business account")
			elif error.get("code") == 100:
				analysis["likely_causes"].append("Invalid parameter")
				analysis["solutions"].append("Check phone number format and API parameters")
			elif error.get("code") == 190:
				analysis["likely_causes"].append("Invalid access token")
				analysis["solutions"].append("Regenerate access token in WhatsApp Business Manager")

	except json.JSONDecodeError:
		analysis["likely_causes"].append("Invalid response format")
		analysis["solutions"].append("Check API endpoint and version")

	# General analysis based on status code
	if status_code == 400:
		analysis["likely_causes"].append("Bad request - check parameters")
		analysis["solutions"].extend([
			"Verify phone number format (country code without +)",
			"Check if recipient has WhatsApp",
			"Ensure business account is verified",
			"Try different API version (v18.0 instead of v22.0)"
		])
	elif status_code == 401:
		analysis["likely_causes"].append("Authentication failed")
		analysis["solutions"].append("Check access token validity")
	elif status_code == 403:
		analysis["likely_causes"].append("Insufficient permissions")
		analysis["solutions"].append("Check business account permissions")

	return analysis


@frappe.whitelist()
def diagnose_whatsapp_400_error():
	"""
	Diagnose common 400 errors with WhatsApp API
	"""
	try:
		settings = frappe.get_doc("WhatsApp Setup", "WhatsApp Setup")

		diagnosis = {
			"settings_check": {},
			"common_issues": [],
			"recommendations": []
		}

		# Check settings
		diagnosis["settings_check"] = {
			"enabled": settings.enabled,
			"url": settings.url,
			"version": settings.version,
			"phone_id": settings.phone_id,
			"business_id": settings.business_id,
			"app_id": settings.app_id,
			"has_token": bool(settings.get_password("token"))
		}

		# Common 400 error causes
		diagnosis["common_issues"] = [
			{
				"issue": "Business Account Not Verified",
				"description": "Your WhatsApp Business account needs to be verified",
				"solution": "Complete business verification in WhatsApp Business Manager"
			},
			{
				"issue": "Phone Number Not Verified",
				"description": "The recipient phone number needs to be verified",
				"solution": "Recipient must have WhatsApp and be verified"
			},
			{
				"issue": "Incorrect Phone ID",
				"description": "Phone ID doesn't match your business account",
				"solution": "Verify Phone ID in WhatsApp Business Manager"
			},
			{
				"issue": "Missing Permissions",
				"description": "Access token doesn't have messaging permissions",
				"solution": "Regenerate token with messaging permissions"
			},
			{
				"issue": "API Version Mismatch",
				"description": "Using wrong API version",
				"solution": "Use v18.0 or v19.0 (not v22.0 for basic messaging)"
			}
		]

		# Specific recommendations based on your error
		diagnosis["recommendations"] = [
			"1. Check if your business account is verified in WhatsApp Business Manager",
			"2. Verify the Phone ID (821639214367885) is correct for your account",
			"3. Try using API version v18.0 instead of v22.0",
			"4. Ensure the recipient number (254740743521) has WhatsApp installed",
			"5. Test with a different phone number first",
			"6. Check if your access token has 'whatsapp_business_messaging' permission"
		]

		return diagnosis

	except Exception as e:
		return {
			"error": str(e),
			"message": "Could not diagnose WhatsApp setup"
		}


@frappe.whitelist()
def test_simple_text_message(phone_number, message="Test message"):
	"""
	Test simple text message to debug the 400 error

	Args:
	    phone_number (str): Phone number to send to
	    message (str): Test message

	Returns:
	    dict: Test result with detailed debugging info
	"""
	try:
		# Get settings
		settings = frappe.get_doc("WhatsApp Setup", "WhatsApp Setup")
		token = settings.get_password("token")

		# Format phone number
		formatted_number = format_phone_number(phone_number)

		# Prepare the request data exactly as it will be sent
		data = {
			"messaging_product": "whatsapp",
			"to": formatted_number,
			"type": "text",
			"text": {"preview_url": True, "body": message},
		}

		headers = {
			"authorization": f"Bearer {token}",
			"content-type": "application/json",
		}

		# Log the exact request that will be sent
		request_url = f"{settings.url}/{settings.version}/{settings.phone_id}/messages"
		request_data = json.dumps(data, indent=2)

		# Make the actual request
		response = frappe.integrations.utils.make_post_request(
			request_url, headers=headers, data=request_data
		)

		return {
			"success": True,
			"message": "Text message test successful",
			"request_url": request_url,
			"request_data": data,
			"response": response,
			"phone_number": formatted_number,
			"message_content": message,
		}

	except Exception as e:
		error_message = str(e)
		error_details = {}

		if frappe.flags.integration_request:
			try:
				error_response = frappe.flags.integration_request.json()
				error_details = error_response
				if "error" in error_response:
					error_message = error_response["error"].get(
						"message", error_response["error"].get("Error", error_message)
					)
			except Exception:
				pass

		return {
			"success": False,
			"error": error_message,
			"error_details": error_details,
			"request_url": request_url if "request_url" in locals() else None,
			"request_data": data if "data" in locals() else None,
			"phone_number": (formatted_number if "formatted_number" in locals() else None),
			"message_content": message,
		}


@frappe.whitelist()
def test_template_with_parameters(template_name, phone_number, parameters=None):
	"""
	Test a specific template with parameters to debug the 400 error

	Args:
	    template_name (str): Name of the template to test
	    phone_number (str): Phone number to send to
	    parameters (list): Template parameters

	Returns:
	    dict: Test result with detailed debugging info
	"""
	try:
		# Get template details
		template = frappe.get_doc("WhatsApp Message Templates", template_name)

		# Prepare the request data exactly as it will be sent
		data = {
			"messaging_product": "whatsapp",
			"to": format_phone_number(phone_number),
			"type": "template",
			"template": {
				"name": template.actual_name or template.template_name,
				"language": {"code": template.language_code},
				"components": [],
			},
		}

		# Process parameters
		if parameters:
			if isinstance(parameters, str):
				try:
					parameters = json.loads(parameters)
				except Exception:
					parameters = [parameters]

			# Validate and clean parameters
			cleaned_parameters = []
			for param in parameters:
				if param is not None:
					cleaned_parameters.append(str(param).strip())
				else:
					cleaned_parameters.append("")

			# Add body parameters
			if cleaned_parameters:
				parameters_data = []
				for param in cleaned_parameters:
					parameters_data.append({"type": "text", "text": param})

				data["template"]["components"].append({"type": "body", "parameters": parameters_data})

		# Get settings
		settings = frappe.get_doc("WhatsApp Setup", "WhatsApp Setup")
		token = settings.get_password("token")

		headers = {
			"authorization": f"Bearer {token}",
			"content-type": "application/json",
		}

		# Log the exact request that will be sent
		request_url = f"{settings.url}/{settings.version}/{settings.phone_id}/messages"
		request_data = json.dumps(data, indent=2)

		# Make the actual request
		response = frappe.integrations.utils.make_post_request(
			request_url, headers=headers, data=request_data
		)

		return {
			"success": True,
			"message": "Template test successful",
			"request_url": request_url,
			"request_data": data,
			"response": response,
			"template_info": {
				"name": template.name,
				"actual_name": template.actual_name,
				"template_name": template.template_name,
				"language_code": template.language_code,
				"status": template.status,
				"field_names": template.field_names,
				"sample_values": template.sample_values,
			},
			"parameters_used": cleaned_parameters if parameters else [],
		}

	except Exception as e:
		error_message = str(e)
		error_details = {}

		if frappe.flags.integration_request:
			try:
				error_response = frappe.flags.integration_request.json()
				error_details = error_response
				if "error" in error_response:
					error_message = error_response["error"].get(
						"message", error_response["error"].get("Error", error_message)
					)
			except Exception:
				pass

		return {
			"success": False,
			"error": error_message,
			"error_details": error_details,
			"request_url": request_url if "request_url" in locals() else None,
			"request_data": data if "data" in locals() else None,
			"template_info": {
				"name": template.name if "template" in locals() else None,
				"actual_name": template.actual_name if "template" in locals() else None,
				"template_name": (template.template_name if "template" in locals() else None),
				"language_code": (template.language_code if "template" in locals() else None),
				"status": template.status if "template" in locals() else None,
				"field_names": template.field_names if "template" in locals() else None,
				"sample_values": (template.sample_values if "template" in locals() else None),
			},
			"parameters_used": (cleaned_parameters if "cleaned_parameters" in locals() else []),
		}


def generate_and_attach_invoice_pdf(invoice_name, print_format="Standard", lang="en"):
	"""
	Generate PDF for a Sales Invoice, attach it, and return full URL
	"""
	try:
		# Generate PDF content
		pdf_content = frappe.get_print("Sales Invoice", invoice_name, print_format, as_pdf=True)

		# Create File record in /files
		filedoc = frappe.get_doc(
			{
				"doctype": "File",
				"file_name": f"{invoice_name}.pdf",
				"attached_to_doctype": "Sales Invoice",
				"attached_to_name": invoice_name,
				"content": pdf_content,
				"is_private": 0,
			}
		)
		filedoc.save(ignore_permissions=True)

		# Return full URL to the file
		return get_url(filedoc.file_url)

	except Exception:
		frappe.log_error(frappe.get_traceback(), "generate_and_attach_invoice_pdf Failed")
		raise
