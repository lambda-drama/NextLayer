import json
import mimetypes

import frappe
from frappe.integrations.utils import make_post_request

from .whatsapp_utils import get_custom_attachment_url, get_document_attachment_url


def make_wasender_api_call(
	data: dict,
	endpoint: str,
	reference_doctype: str = None,
	reference_name: str = None,
	update_existing_chat: frappe._dict = None,
):
	"""Make the actual API call to WASender
	Args:
	    data (dict): Payload to send to WASender API
	    endpoint (str): WASender API endpoint (e.g. "send-message")
	    reference_doctype (str, optional): DocType for linking the chat message. Defaults to None.
	    reference_name (str, optional): Doc name for linking the chat message. Defaults to None.
	    update_existing_chat (frappe._dict, optional): Existing WhatsApp Chat document to update instead of creating a new one. Defaults to None.
	Returns:
	    dict: Response with success status and message details
	"""
	settings = frappe.get_doc("WhatsApp Setup", "WhatsApp Setup")

	if not settings.np_enabled:
		return {"success": False, "error": "WASender integration is disabled."}
	if not settings.np_token:
		return {"success": False, "error": "WASender token not configured."}
	if not settings.np_url:
		return {"success": False, "error": "WASender URL not configured."}

	url = f"{settings.np_url}{endpoint}"
	headers = {
		"Authorization": f"Bearer {settings.np_token}",
		"Content-Type": "application/json",
	}

	try:
		response = make_post_request(url, json=data, headers=headers)

		message_id = response.get("msgId") if isinstance(response, dict) else None

		if update_existing_chat:
			chat_doc = update_existing_chat
			if message_id:
				chat_doc.message_id = message_id
			chat_doc.status = "Success"
			chat_doc.save(ignore_permissions=True)
			frappe.db.commit()
		else:
			chat_doc = frappe.new_doc("WhatsApp Chat")
			chat_doc.type = "Outgoing"
			chat_doc.to = data.get("to", "")
			chat_doc.message = data.get("message") or data.get("text") or ""
			chat_doc.status = "Success"
			if reference_doctype and reference_name:
				chat_doc.reference_doctype = reference_doctype
				chat_doc.reference_name = reference_name
			if message_id:
				chat_doc.message_id = message_id
			chat_doc.insert(ignore_permissions=True)
			frappe.db.commit()

		return {
			"success": True,
			"message_id": message_id,
			"whatsapp_message_name": chat_doc.name,
		}

	except Exception as e:
		frappe.log_error(
			f"WASender API Error:\n"
			f"URL: {url}\n"
			f"Data: {json.dumps(data, indent=2)}\n"
			f"Error: {str(e)}",
			"WASender WhatsApp Messaging",
		)

		if update_existing_chat:
			update_existing_chat.status = "Failed"
			update_existing_chat.save(ignore_permissions=True)
			frappe.db.commit()

		return {"success": False, "error": str(e)}


@frappe.whitelist()
def send_whatsapp_message(
	to: str,
	message: str,
	attach_document: bool = False,
	reference_doctype: str = None,
	reference_name: str = None,
	letterhead: bool = False,
	custom_attachment: str = None,
) -> dict:
	"""
	Send WhatsApp message using the WASender API.
	Args:
	    to (str): Recipient phone number (with country code, e.g. +1234567890) or Group Id
	    message (str): Text message to send
	    attach_document (bool): Whether to attach a document from Frappe
	    reference_doctype (str): DocType of the document to attach
	    reference_name (str): Name of the document to attach
	    letterhead (bool): Whether to use letterhead for the document attachment
	    custom_attachment (str): URL of a custom attachment to include in the message
	Returns:
	    dict: Response from the WASender API call
	"""
	FILE_TYPES = {
		"application/pdf": "documentUrl",
		"image/jpeg": "imageUrl",
		"image/png": "imageUrl",
		"video/mp4": "videoUrl",
		"audio/mpeg": "audioUrl",
	}

	data = {"to": to}

	if message:
		data["text"] = message

	if attach_document and reference_doctype and reference_name:
		document_url = get_document_attachment_url(attach_document, reference_doctype, reference_name, letterhead)
		if document_url:
			data["documentUrl"] = document_url

	if custom_attachment:
		custom_attachment_url = get_custom_attachment_url(custom_attachment)
		if custom_attachment_url:
			file_type, _ = mimetypes.guess_type(custom_attachment_url)
			if file_type and file_type in FILE_TYPES:
				data[FILE_TYPES[file_type]] = custom_attachment_url

	return make_wasender_api_call(
		data,
		"send-message",
		reference_doctype=reference_doctype,
		reference_name=reference_name,
	)

@frappe.whitelist()
def send_whatsapp_from_chat(chat_name: str) -> dict:
	"""
	Send WhatsApp message from an existing WhatsApp Chat document
	using the WASender API.

	Args:
	    chat_name (str): Name of the WhatsApp Chat document

	Returns:
	    dict: Response with success status and message details
	"""
	try:
		chat_doc = frappe.get_doc("WhatsApp Chat", chat_name)

		if chat_doc.type != "Outgoing":
			return {"success": False, "error": "Can only send outgoing messages"}

		if not chat_doc.to:
			return {"success": False, "error": "Recipient phone number (TO) is required"}

		formatted_number = formart_number(chat_doc.to)

		data = {"to": formatted_number}

		FILE_TYPES = {
			"image/jpeg": "imageUrl",
			"image/png": "imageUrl",
			"video/mp4": "videoUrl",
			"audio/mpeg": "audioUrl",
		}

		if chat_doc.message:
			data["text"] = chat_doc.message

		if chat_doc.attach:
			attachment_url = get_custom_attachment_url(chat_doc.attach)
			if attachment_url:
				file_type, _ = mimetypes.guess_type(attachment_url)
				if file_type and file_type in FILE_TYPES:
					data[FILE_TYPES[file_type]] = attachment_url
				else:
					data["documentUrl"] = attachment_url

		return make_wasender_api_call(data, "send-message", update_existing_chat=chat_doc)

	except Exception as e:
		frappe.log_error(
			f"Error sending WhatsApp from chat (WASender): {str(e)}\nTraceback: {frappe.get_traceback()}",
			"WASender WhatsApp Send from Chat",
		)
		return {"success": False, "error": str(e)}

def formart_number(number: str) -> str:
	if not number.startswith("+"):
		number = f"+{number}"
	return number


def get_groups():
    settings = frappe.get_doc("WhatsApp Setup", "WhatsApp Setup")

    if not settings.np_enabled:
        return {"success": False, "error": "WASender integration is disabled."}
    if not settings.np_token:
        return {"success": False, "error": "WASender token not configured."}
    if not settings.np_url:
        return {"success": False, "error": "WASender URL not configured."}

    url = f"{settings.np_url}get-groups"
    headers = {
        "Authorization": f"Bearer {settings.np_token}",
    }

    try:
        response = make_post_request(url, headers=headers)
        return {"success": True, "groups": response.get("data", [])}

    except Exception as e:
        frappe.log_error(
            f"WASender API Error while fetching group IDs:\n"
            f"URL: {url}\n"
            f"Error: {str(e)}",
            "WASender WhatsApp Get Groups",
        )
        return {"success": False, "error": str(e)}
