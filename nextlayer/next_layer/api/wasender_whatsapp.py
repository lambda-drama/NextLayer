import frappe
from frappe.integrations.utils import make_post_request
from .whatsapp_utils import get_document_attachment_url, get_custom_attachment_url
import mimetypes


def make_wasender_api_call(data: dict, endpoint: str):
    settings = frappe.get_doc("WhatsApp Setup", "WhatsApp Setup")
    try:
        if not settings.enabled:
            raise Exception("WhatsApp integration is disabled.")
        
        if not settings.np_token:
            raise Exception("WhatsApp token not configured.")
    except Exception as e:
        frappe.log_error(f"WhatsApp Setup Error: {str(e)}", "WhatsApp Setup Error")
        return {"success": False, "error": str(e)}


    url = f"{settings.np_url}{endpoint}"

    headers = {
        "Authorization": f"Bearer {settings.np_token}",
        "Content-Type": "application/json"
    }

    response = make_post_request(url, json=data, headers=headers)

    return response.json()
@frappe.whitelist()
def send_whatsapp_message(to: str, message: str, attach_document: bool = False, reference_doctype: str = None,
	reference_name: str = None, letterhead: bool = False, custom_attachment: str = None) -> dict:
    """
    Send WhatsApp message using the WASender API.
    Args:
        to (str): Recipient phone number (with country code, e.g. +1234567890) or Group Id
        message (str): Text message to send
        attach_document (bool): Whether to attach a document from Frappe
        reference_doctype (str): DocType of the document to attach (from which the attachment will be fetched)
        reference_name (str): Name of the document to attach (from which the attachment will be fetched)
        letterhead (bool): Whether to use letterhead for the document attachment
        custom_attachment (str): URL of a custom attachment to include in the message
    Returns:
        dict: Response from the WASender API call

    """
    data = {
        "to": to,
    }
    if message:
        data["message"] = message

    FILE_TYPES = {
        "application/pdf": "documentUrl",
        "image/jpeg": "imageUrl",
        "image/png": "imageUrl",
        "video/mp4": "videoUrl",
        "audio/mpeg": "audioUrl"
    }
    if attach_document and reference_doctype and reference_name:
        document_url = get_document_attachment_url(attach_document, reference_doctype, reference_name, letterhead)
        if document_url:
            data["documentUrl"] = document_url
    if custom_attachment:
        custom_attachment_url = get_custom_attachment_url(custom_attachment)
        if custom_attachment_url:
            file_type, _ = mimetypes.guess_type(custom_attachment_url)
            data[FILE_TYPES[file_type]] = custom_attachment_url
   
    response = make_wasender_api_call(data, "send-message")
    return response
        

def formart_number(number: str) -> str:
    # Remove any non-digit characters
    if not number.startswith("+"):
        formatted_number = f"+{number}"
    return formatted_number


@frappe.whitelist()
def send_whatsapp_from_chat(chat_name):
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

        # Validate outgoing direction
        if chat_doc.type != "Outgoing":
            return {"success": False, "error": "Can only send outgoing messages"}

        # Validate recipient
        if not chat_doc.to:
            return {"success": False, "error": "Recipient phone number (TO) is required"}

        # Format phone number (WASender expects "+" prefix)
        formatted_number = formart_number(chat_doc.to)

        # Build payload
        data = {
            "to": formatted_number,
        }
        
        FILE_TYPES = {
            "image/jpeg": "imageUrl",
            "image/png": "imageUrl",
            "video/mp4": "videoUrl",
            "audio/mpeg": "audioUrl",
        }

        # Handle message content
        if chat_doc.message:
            data["text"] = chat_doc.message

        # Handle attachment
        # TODO: add documentUrl to FILE_TYPES
        if chat_doc.attach:
            attachment_url = get_custom_attachment_url(chat_doc.attach)
            if attachment_url:
                file_type, _ = mimetypes.guess_type(attachment_url)
                if file_type and file_type in FILE_TYPES:
                    data[FILE_TYPES[file_type]] = attachment_url
                else:
                    data["documentUrl"] = attachment_url

     
        response = make_wasender_api_call(data, "send-message")

        # Update chat document
        if response and response.get("success") is not False:
            chat_doc.status = "Success"
            if isinstance(response, dict) and response.get("id"):
                chat_doc.message_id = response.get("id")
            chat_doc.save(ignore_permissions=True)
            frappe.db.commit()
            return {
                "success": True,
                "message_id": response.get("id"),
                "whatsapp_message_name": chat_doc.name,
            }
        else:
            chat_doc.status = "Failed"
            chat_doc.save(ignore_permissions=True)
            frappe.db.commit()
            return {
                "success": False,
                "error": response.get("error", "Unknown error from WASender API"),
                "whatsapp_message_name": chat_doc.name,
            }

    except Exception as e:
        frappe.log_error(
            f"Error sending WhatsApp from chat (WASender): {str(e)}\nTraceback: {frappe.get_traceback()}",
            "WASender WhatsApp Send from Chat",
        )
        return {"success": False, "error": str(e)}

