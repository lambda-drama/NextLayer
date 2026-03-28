import frappe
from frappe.integrations.utils import make_post_request, make_get_request

from .whatsapp_utils import get_custom_attachment_url, get_document_attachment_url

import json
import mimetypes
import pyqrcode
import requests


def get_wasender_settings() -> frappe._dict:
	"""
	Get WASender settings from WhatsApp Setup document.
	Returns a _dict with all relevant fields including decrypted password fields.

	Returns:
		frappe._dict: Settings object with fields:
			- np_enabled (bool)
			- np_url (str)
			- np_token (str): decrypted API token
			- pat_token (str): decrypted PAT token
	"""
	settings = frappe.get_doc("WhatsApp Setup", "WhatsApp Setup")

	return frappe._dict({
		"np_enabled": settings.np_enabled,
		"np_url": settings.np_url,
		"np_token": settings.get_password("np_token"),
		"pat_token": settings.get_password("pat_token"),
	})


def make_wasender_api_call(
	data: dict,
	endpoint: str,
	reference_doctype: str = None,
	reference_name: str = None,
	update_existing_chat: frappe._dict = None,
) -> dict:
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
	settings = get_wasender_settings()

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
		resp = requests.post(url, json=data, headers=headers)
		resp.raise_for_status()
		response = resp.json()

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
	chat_doc = frappe.get_doc("WhatsApp Chat", chat_name)

	if chat_doc.type != "Outgoing":
		return {"success": False, "error": "Can only send outgoing messages"}

	if not chat_doc.to and not chat_doc.to_group:
		return {"success": False, "error": "Recipient phone number (TO) is required"}

	group = frappe.get_doc("Whatsapp Group Profile", chat_doc.to_group) if chat_doc.to_group_message else None

	send_to = formart_number(chat_doc.to) if not chat_doc.to_group_message else group.group_id

	data = {"to": send_to}

	FILE_TYPES = {
		"application/pdf": "documentUrl",
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

	return make_wasender_api_call(data, "send-message", update_existing_chat=chat_doc)


def send_bulk_messages(
	recipients: list,
	message: str,
	reference_doctype: str = None,
	reference_name: str = None,
) -> dict:
	"""
	Send bulk WhatsApp messages using WASender API
	Args:
		recipients (list): List of phone numbers
		message (str): Message content
		reference_doctype (str, optional): Reference DocType
		reference_name (str, optional): Reference DocName

	Returns:
		dict: Response with success status and message details
	"""
	results = []
	for recipient in recipients:
		result = make_wasender_api_call(
			{"to": formart_number(recipient), "text": message},
			"send-message",
			reference_doctype=reference_doctype,
			reference_name=reference_name,
		)
		results.append({"recipient": recipient, "result": result})
		frappe.sleep(2)

	return {
		"total_sent": len([r for r in results if r["result"].get("success")]),
		"total_failed": len([r for r in results if not r["result"].get("success")]),
		"details": results,
	}


def formart_number(number: str) -> str:
	if not number.startswith("+"):
		number = f"+{number}"
	return number


@frappe.whitelist()
def sync_groups() -> dict:
	"""Fetch groups from WASender and store group metadata only"""

	settings = get_wasender_settings()

	if not settings.np_enabled:
		return {"success": False, "error": "WASender integration disabled"}

	url = f"{settings.np_url}groups"
	headers = {
		"Authorization": f"Bearer {settings.np_token}"
	}

	response = make_get_request(url, headers=headers)

	if not response.get("success"):
		return {"success": False, "error": response.get("message")}

	groups = response.get("data", [])

	existing = set(
		frappe.get_all(
			"Whatsapp Group Profile",
			pluck="group_id"
		)
	)

	for group in groups:
		if group["id"] in existing:
			continue

		doc = frappe.new_doc("Whatsapp Group Profile")
		doc.group_name = group.get("name") or "Unnamed Group"
		doc.group_id = group["id"]
		doc.profile_picture = group.get("imgUrl")
		doc.insert(ignore_permissions=True)

	frappe.db.commit()

	return {"success": True, "groups_synced": len(groups)}


@frappe.whitelist()
def update_group_members(group_id):
	"""
	Fetch members for a WhatsApp group and append only new members
	without creating duplicates.
	"""
	group = frappe.get_doc("Whatsapp Group Profile", {"group_id": group_id})

	response = get_group_members(group_id)

	if not response.get("success"):
		return response

	members = response.get("members", [])

	existing_members = {m.phone_number for m in group.members}

	added = 0

	for m in members:
		phone = m.get("pn", "")

		if phone in existing_members:
			continue

		group.append(
			"members",
			{
				"phone_number": phone,
				"is_admin": m.get("Admin", False),
			}
		)

		existing_members.add(phone)
		added += 1

	if added:
		group.save(ignore_permissions=True)
		frappe.db.commit()

	return {
		"success": True,
		"members_added": added,
		"total_members": len(group.members)
	}


def get_group_members(group_id: str) -> dict:
	"""
	Get members of a WhatsApp group from WASender API

	Args:
		group_id (str): ID of the WhatsApp group

	Returns:
		dict: Response with success status and list of members or error message
	"""
	settings = get_wasender_settings()

	if not settings.np_enabled:
		return {"success": False, "error": "WASender integration is disabled."}
	if not settings.np_token:
		return {"success": False, "error": "WASender token not configured."}
	if not settings.np_url:
		return {"success": False, "error": "WASender URL not configured."}

	url = f"{settings.np_url}groups/{group_id}/metadata"
	headers = {
		"Authorization": f"Bearer {settings.np_token}",
	}

	try:
		response = make_get_request(url, headers=headers)
		if not response.get("success"):
			frappe.throw(f"Failed to fetch group members: {response.get('message')}")
			return {"success": False, "error": response.get("message")}
		return {"success": True, "members": response.get("data", []).get("participants", [])}

	except Exception as e:
		frappe.log_error(
			f"WASender API Error while fetching group members:\n"
			f"URL: {url}\n"
			f"Group ID: {group_id}\n"
			f"Error: {str(e)}",
			"WASender WhatsApp Get Group Members",
		)
		return {"success": False, "error": str(e)}


def get_whatsapp_session_qr_code() -> dict:
	"""
	Get WhatsApp session QR code from WASender API for authentication
	Returns:
		dict: Response with success status and QR code URL or error message
	"""
	settings = get_wasender_settings()

	if not settings.np_enabled:
		return {"success": False, "error": "WASender integration is disabled."}
	if not settings.pat_token:
		return {"success": False, "error": "WASender PAT token not configured."}
	if not settings.np_url:
		return {"success": False, "error": "WASender URL not configured."}

	url = f"{settings.np_url}whatsapp-sessions/1/qrcode"
	headers = {
		"Authorization": f"Bearer {settings.pat_token}",
	}

	try:
		response = make_get_request(url, headers=headers)
		if not response.get("success"):
			frappe.throw(f"Failed to fetch QR code: {response.get('message')}")
			return {"success": False, "error": response.get("message")}
		qr_code = response.get("data", {}).get("qrCode")
		if not qr_code:
			frappe.throw("QR code not found in response")
			return {"success": False, "error": "QR code not found in response"}
		return {"success": True, "qr_code": qr_code}
	except Exception as e:
		frappe.log_error(
			f"WASender API Error while fetching QR code:\n"
			f"URL: {url}\n"
			f"Error: {str(e)}",
			"WASender WhatsApp Get QR Code",
		)
		return {"success": False, "error": str(e)}


@frappe.whitelist()
def qr_code_to_image(qr_code: str, scale: int = 5) -> str:
	"""
	Convert a string to a base64 QR code data URL.
	Uses pyqrcode, which is already a Frappe/ERPNext dependency.
	"""
	return "data:image/png;base64," + pyqrcode.create(qr_code).png_as_base64_str(scale=scale, quiet_zone=1)