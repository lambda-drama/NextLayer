import frappe
from werkzeug.wrappers import Response
import json


@frappe.whitelist(allow_guest=True)
def handle_webhook():
    if frappe.request.method != "POST":
        return {"success": False, "error": "Invalid request method"}
    verify_webhook_signature()

def verify_webhook_signature():
    try:
        verify_signature = frappe.get_single_value("WhatsApp Setup", "np_webhook_verify_token")
        signature = frappe.request.headers.get("x-webhook-signature")

        if not signature or signature != verify_signature:
            frappe.throw("Invalid webhook signature", frappe.AuthenticationError)
        else:
            payload = frappe.request.get_data(as_text=True)
            clean_payload = json.loads(payload) if isinstance(payload, str) else payload
            handle_webhook_event(clean_payload)
            return Response("Webhook verified successfully", status=200)
    except Exception as e:
        frappe.log_error(f"Webhook signature verification failed: {str(e)}", "WASender Webhook")
        frappe.throw("Webhook signature verification failed", frappe.AuthenticationError)


def handle_webhook_event(payload: dict):

    event = payload.get("event")
    match event:
        case "messages.received":
            handle_message_received(payload)

        case "message.sent":
            handle_message_sent(payload)

        
        case _:
            frappe.log_error(f"Unknown event type: {event}", "Wasender Webhook")


def handle_message_received(payload: dict):
    try:
        message = payload.get("data", {}).get("messages", {})

        sender = message.get("key", {}).get("remoteJid", "")
        message_id = message.get("key", {}).get("id", "")
        clean_number = message.get("key", {}).get("cleanedSenderPn", "")
        message_body = message.get("messageBody") or message.get("message", {}).get("conversation", "")

        frappe.log_error(
            f"Sender: {sender}\nMessage ID: {message_id}\nBody: {message_body}",
            "WASender Debug Incoming"
        )

        chat_doc = frappe.new_doc("WhatsApp Chat")
        chat_doc.type = "Incoming"
        chat_doc.set("from", sender)
        chat_doc.profile_name = clean_number
        chat_doc.message = message_body
        chat_doc.message_id = message_id
        chat_doc.status = "Received"
        chat_doc.content_type = "text"
        chat_doc.insert(ignore_permissions=True)
        frappe.db.commit()

    except Exception as e:
        frappe.log_error(
            f"Error: {str(e)}\nTraceback: {frappe.get_traceback()}\nPayload: {json.dumps(payload, indent=2)}",
            "WASender Incoming Message Error"
        )
def handle_message_sent(payload: dict):
    """
    Handle message sent event from WASender
    Args:
        payload (dict): Parsed JSON payload from WASender webhook 
    """
    message_data = payload.get("data", {})
    message_id = message_data.get("key", {}).get("id")
    recipient = message_data.get("key", {}).get("remoteJid")
    success = message_data.get("success", False)

    # Find the corresponding WhatsApp Chat document based on recipient and message content
    chat_doc = frappe.db.get_value(
        "WhatsApp Chat",
        {"to": recipient, "message": message_data.get("message", {}).get("conversation", "")},
        ["name"],
    )

    if chat_doc:
        chat_doc = frappe.get_doc("WhatsApp Chat", chat_doc[0])
        chat_doc.status = "Sent" if success else "Failed"
        chat_doc.message_id = message_id
        chat_doc.save(ignore_permissions=True)
        frappe.db.commit()
    else:
        frappe.log_error(f"Could not find matching WhatsApp Chat for sent message to {recipient}", "WASender Webhook")

   