"""
WhatsApp Webhook Handler for Meta (Facebook) WhatsApp Business API
Handles incoming messages and status updates from WhatsApp
"""

import json

import frappe
import requests
from werkzeug.wrappers import Response


@frappe.whitelist(allow_guest=True)
def webhook():
	"""
	Meta WhatsApp webhook endpoint
	GET: Webhook verification (Meta sends GET request to verify webhook)
	POST: Incoming messages and status updates
	"""
	if frappe.request.method == "GET":
		return handle_webhook_verification()
	return handle_webhook_post()


def handle_webhook_verification():
	"""
	Handle webhook verification from Meta
	Meta sends a GET request with hub.challenge and hub.verify_token
	We need to verify the token and return the challenge
	"""
	try:
		hub_challenge = frappe.form_dict.get("hub.challenge")
		hub_verify_token = frappe.form_dict.get("hub.verify_token")
		
		# Get webhook verify token from settings
		webhook_verify_token = frappe.db.get_single_value("WhatsApp Setup", "webhook_verify_token")
		
		if not webhook_verify_token:
			frappe.log_error("Webhook verify token not configured in WhatsApp Setup", "WhatsApp Webhook Verification")
			return Response("Webhook verify token not configured", status=403)
		
		# Verify the token matches
		if hub_verify_token != webhook_verify_token:
			frappe.log_error(
				f"Webhook verification failed: Token mismatch. Expected: {webhook_verify_token}, Received: {hub_verify_token}",
				"WhatsApp Webhook Verification"
			)
			return Response("Verify token does not match", status=403)
		
		# Return the challenge to complete verification
		if hub_challenge:
			frappe.logger().info(f"WhatsApp webhook verified successfully. Challenge: {hub_challenge}")
			return Response(hub_challenge, status=200)
		else:
			return Response("Challenge not provided", status=400)
			
	except Exception as e:
		frappe.log_error(f"Error in webhook verification: {str(e)}", "WhatsApp Webhook Verification")
		return Response(f"Error: {str(e)}", status=500)


def handle_webhook_post():
	"""
	Handle POST requests from Meta webhook
	Processes incoming messages and status updates
	"""
	try:
		# Get raw data from request
		if hasattr(frappe.local, 'form_dict'):
			data = frappe.local.form_dict
		else:
			# Try to get JSON data from request
			data = frappe.request.get_json() if frappe.request.is_json else frappe.form_dict
		
		# Log webhook data for debugging (optional - can be removed in production)
		frappe.logger().debug(f"WhatsApp Webhook POST Data: {json.dumps(data, indent=2)}")
		
		# Meta webhook structure:
		# {
		#   "object": "whatsapp_business_account",
		#   "entry": [{
		#     "id": "WHATSAPP_BUSINESS_ACCOUNT_ID",
		#     "changes": [{
		#       "value": {
		#         "messaging_product": "whatsapp",
		#         "metadata": {...},
		#         "contacts": [...],
		#         "messages": [...],  # For incoming messages
		#         "statuses": [...]   # For message status updates
		#       },
		#       "field": "messages" or "message_template_status_update"
		#     }]
		#   }]
		# }
		
		# Verify this is a WhatsApp Business Account webhook
		if data.get("object") != "whatsapp_business_account":
			frappe.logger().warning(f"Received webhook for object type: {data.get('object')}, expected 'whatsapp_business_account'")
			return Response("Invalid webhook object", status=200)
		
		# Extract entries from webhook payload
		# Structure: {"object": "...", "entry": [{"id": "...", "changes": [...]}]}
		entries = data.get("entry", [])
		if not entries:
			frappe.logger().warning(f"WhatsApp webhook received data without entries: {json.dumps(data)}")
			return Response("No entries found", status=200)  # Return 200 to prevent retries
		
		# Process each entry
		for entry in entries:
			entry_id = entry.get("id")  # Business account ID
			changes = entry.get("changes", [])
			
			if not changes:
				frappe.logger().debug(f"Entry {entry_id} has no changes")
				continue
			
			for change in changes:
				value = change.get("value", {})
				field = change.get("field", "")
				
				# Log the field type for debugging
				frappe.logger().debug(f"Processing webhook change: field={field}, entry_id={entry_id}")
				
				# Handle incoming messages
				# Field will be "messages" and value will contain "messages" array
				if field == "messages":
					if value.get("messages"):
						process_incoming_messages(value)
					elif value.get("statuses"):
						process_message_status_updates(value)
				
				# Handle template status updates
				elif field == "message_template_status_update":
					process_template_status_update(value)
		
		return Response("OK", status=200)
		
	except Exception as e:
		frappe.log_error(
			f"Error processing WhatsApp webhook: {str(e)}\nTraceback: {frappe.get_traceback()}",
			"WhatsApp Webhook Error"
		)
		# Return 200 to prevent Meta from retrying
		return Response(f"Error: {str(e)}", status=200)


def process_incoming_messages(value):
	"""
	Process incoming messages from webhook
	Creates WhatsApp Chat records for each message
	
	Args:
		value: The value object from webhook change
			Contains:
			- messaging_product: "whatsapp"
			- metadata: {display_phone_number, phone_number_id}
			- contacts: [{profile: {name}, wa_id}]
			- messages: [{from, id, timestamp, type, text/image/video/etc}]
	"""
	messages = value.get("messages", [])
	contacts = value.get("contacts", [])
	metadata = value.get("metadata", {})
	
	# Log metadata for debugging
	frappe.logger().debug(f"Processing {len(messages)} incoming messages from phone_number_id: {metadata.get('phone_number_id')}")
	
	# Create a mapping of phone numbers to profile names
	contact_map = {}
	for contact in contacts:
		phone = contact.get("wa_id")
		profile_name = contact.get("profile", {}).get("name", "")
		if phone:
			contact_map[phone] = profile_name
			frappe.logger().debug(f"Mapped contact: {phone} -> {profile_name}")
	
	# Process each message
	for message in messages:
		try:
			create_whatsapp_chat_from_message(message, contact_map, metadata)
		except Exception as e:
			frappe.log_error(
				f"Error processing incoming message: {str(e)}\nMessage: {json.dumps(message)}\nTraceback: {frappe.get_traceback()}",
				"WhatsApp Incoming Message Error"
			)


def create_whatsapp_chat_from_message(message, contact_map, metadata=None):
	"""
	Create WhatsApp Chat record from incoming message
	
	Args:
		message: Message object from webhook
			- from: Phone number
			- id: Message ID
			- timestamp: Unix timestamp
			- type: Message type (text, image, video, etc.)
			- text/image/video/etc: Message content based on type
		contact_map: Dictionary mapping phone numbers to profile names
		metadata: Optional metadata from webhook (phone_number_id, display_phone_number)
	"""
	message_type = message.get("type")
	from_number = message.get("from")
	message_id = message.get("id")
	timestamp = message.get("timestamp")
	
	# Check if message already exists (prevent duplicates)
	existing_chat = frappe.db.get_value("WhatsApp Chat", {"message_id": message_id}, "name")
	if existing_chat:
		frappe.logger().info(f"Message {message_id} already exists (WhatsApp Chat: {existing_chat}), skipping duplicate")
		return
	
	# Get profile name from contact map
	profile_name = contact_map.get(from_number, "")
	
	frappe.logger().debug(f"Creating WhatsApp Chat for message_id: {message_id}, type: {message_type}, from: {from_number}")
	
	# Handle reply context
	context = message.get("context", {})
	is_reply = bool(context.get("id") and "forwarded" not in context)
	reply_to_message_id = context.get("id") if is_reply else None
	
	# Prepare base chat document data
	chat_data = {
		"doctype": "WhatsApp Chat",
		"type": "Incoming",
		"from": from_number,
		"message_id": message_id,
		"is_reply": is_reply,
		"reply_to_message_id": reply_to_message_id,
		"profile_name": profile_name,
		"status": "received",  # Incoming messages are always received
	}
	
	# Handle different message types
	if message_type == "text":
		chat_data.update({
			"content_type": "text",
			"message": message.get("text", {}).get("body", ""),
		})
	
	elif message_type == "image":
		chat_data.update({
			"content_type": "image",
			"message": message.get("image", {}).get("caption", ""),
		})
		handle_media_attachment(message, "image", chat_data)
	
	elif message_type == "video":
		chat_data.update({
			"content_type": "video",
			"message": message.get("video", {}).get("caption", ""),
		})
		handle_media_attachment(message, "video", chat_data)
	
	elif message_type == "audio":
		chat_data.update({
			"content_type": "audio",
			"message": "Audio message",
		})
		handle_media_attachment(message, "audio", chat_data)
	
	elif message_type == "document":
		document_data = message.get("document", {})
		chat_data.update({
			"content_type": "document",
			"message": document_data.get("caption", document_data.get("filename", "Document")),
		})
		handle_media_attachment(message, "document", chat_data)
	
	elif message_type == "location":
		location = message.get("location", {})
		chat_data.update({
			"content_type": "location",
			"message": f"Location: {location.get('latitude')}, {location.get('longitude')}",
		})
	
	elif message_type == "contacts":
		contacts_data = message.get("contacts", [])
		contact_names = [c.get("name", {}).get("formatted_name", "") for c in contacts_data]
		chat_data.update({
			"content_type": "contact",
			"message": f"Shared contacts: {', '.join(contact_names)}",
		})
	
	elif message_type == "reaction":
		reaction = message.get("reaction", {})
		chat_data.update({
			"content_type": "reaction",
			"message": reaction.get("emoji", ""),
			"reply_to_message_id": reaction.get("message_id"),
		})
	
	elif message_type == "button":
		button = message.get("button", {})
		chat_data.update({
			"content_type": "button",
			"message": button.get("text", ""),
			"reply_to_message_id": button.get("payload"),
		})
	
	elif message_type == "interactive":
		interactive = message.get("interactive", {})
		# Handle different interactive types (button_reply, list_reply, nfm_reply)
		if "button_reply" in interactive:
			chat_data.update({
				"content_type": "button",
				"message": interactive["button_reply"].get("title", ""),
			})
		elif "list_reply" in interactive:
			chat_data.update({
				"content_type": "button",
				"message": interactive["list_reply"].get("title", ""),
			})
		elif "nfm_reply" in interactive:
			chat_data.update({
				"content_type": "flow",
				"message": json.dumps(interactive["nfm_reply"].get("response_json", {})),
			})
		else:
			chat_data.update({
				"content_type": "flow",
				"message": json.dumps(interactive),
			})
	
	elif message_type == "sticker":
		chat_data.update({
			"content_type": "image",  # Stickers are treated as images
			"message": "Sticker",
		})
		# Create chat doc first, then handle media attachment
		chat_doc = frappe.get_doc(chat_data)
		chat_doc.insert(ignore_permissions=True)
		frappe.db.commit()
		
		# Now download and attach media
		handle_media_attachment(message, "sticker", chat_doc)
		return  # Already created, return early
	
	else:
		# Unknown message type - log and store raw data
		frappe.logger().warning(f"Unknown message type: {message_type}")
		chat_data.update({
			"content_type": "text",
			"message": json.dumps(message),
		})
	
	# Check if message already exists (prevent duplicates)
	existing_chat = frappe.db.get_value("WhatsApp Chat", {"message_id": message_id}, "name")
	if existing_chat:
		frappe.logger().info(f"Message {message_id} already exists, skipping duplicate")
		return
	
	# Create the WhatsApp Chat record
	chat_doc = frappe.get_doc(chat_data)
	chat_doc.insert(ignore_permissions=True)
	frappe.db.commit()
	
	frappe.logger().info(f"Created WhatsApp Chat record for incoming message: {message_id}")


def handle_media_attachment(message, media_type, chat_doc):
	"""
	Download and attach media files (image, video, audio, document, sticker)
	
	Args:
		message: The message object from webhook
		media_type: Type of media (image, video, audio, document, sticker)
		chat_doc: The WhatsApp Chat document (already created)
	"""
	try:
		settings = frappe.get_doc("WhatsApp Setup", "WhatsApp Setup")
		token = settings.get_password("token")
		
		if not token:
			frappe.logger().error("WhatsApp token not configured, cannot download media")
			return
		
		media_data = message.get(media_type, {})
		media_id = media_data.get("id")
		
		if not media_id:
			return
		
		# Get media URL from Meta API
		url = f"{settings.url}/{settings.version}/{media_id}"
		headers = {"Authorization": f"Bearer {token}"}
		
		response = requests.get(url, headers=headers, timeout=30)
		
		if response.status_code == 200:
			media_info = response.json()
			media_url = media_info.get("url")
			mime_type = media_info.get("mime_type", "application/octet-stream")
			
			if not media_url:
				return
			
			# Download the actual media file
			media_response = requests.get(media_url, headers=headers, timeout=30)
			
			if media_response.status_code == 200:
				file_data = media_response.content
				
				# Determine file extension from mime type
				extension_map = {
					"image/jpeg": "jpg",
					"image/png": "png",
					"image/gif": "gif",
					"image/webp": "webp",
					"video/mp4": "mp4",
					"video/3gpp": "3gp",
					"audio/ogg": "ogg",
					"audio/aac": "aac",
					"audio/mpeg": "mp3",
					"application/pdf": "pdf",
					"application/vnd.ms-excel": "xls",
					"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
					"application/msword": "doc",
					"application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
				}
				
				file_extension = extension_map.get(mime_type, mime_type.split("/")[-1] if "/" in mime_type else "bin")
				
				# Generate filename
				filename = media_data.get("filename") or f"{frappe.generate_hash(length=10)}.{file_extension}"
				
				# Create File record
				file_doc = frappe.get_doc({
					"doctype": "File",
					"file_name": filename,
					"attached_to_doctype": "WhatsApp Chat",
					"attached_to_name": chat_doc.name,
					"content": file_data,
					"attached_to_field": "attach",
					"is_private": 0,  # Public so WhatsApp can access if needed
				})
				file_doc.save(ignore_permissions=True)
				
				# Update chat document with file URL
				chat_doc.attach = file_doc.file_url
				chat_doc.save(ignore_permissions=True)
				frappe.db.commit()
				
				frappe.logger().info(f"Attached media file {filename} to WhatsApp Chat {chat_doc.name}")
		
	except Exception as e:
		frappe.log_error(
			f"Error downloading media attachment: {str(e)}\nMedia Type: {media_type}\nChat Doc: {chat_doc.name if chat_doc else 'None'}",
			"WhatsApp Media Download Error"
		)
		for message in messages:
			message_type = message["type"]
			is_reply = True if message.get("context") and "forwarded" not in message.get("context") else False
			reply_to_message_id = message["context"]["id"] if is_reply else None
			if message_type == "text":
				frappe.get_doc(
					{
						"doctype": "WhatsApp Chat",
						"type": "Incoming",
						"from": message["from"],
						"message": message["text"]["body"],
						"message_id": message["id"],
						"reply_to_message_id": reply_to_message_id,
						"is_reply": is_reply,
						"content_type": message_type,
						"profile_name": sender_profile_name,
					}
				).insert(ignore_permissions=True)
			elif message_type == "reaction":
				frappe.get_doc(
					{
						"doctype": "WhatsApp Chat",
						"type": "Incoming",
						"from": message["from"],
						"message": message["reaction"]["emoji"],
						"reply_to_message_id": message["reaction"]["message_id"],
						"message_id": message["id"],
						"content_type": "reaction",
						"profile_name": sender_profile_name,
					}
				).insert(ignore_permissions=True)
			elif message_type == "interactive":
				frappe.get_doc(
					{
						"doctype": "WhatsApp Chat",
						"type": "Incoming",
						"from": message["from"],
						"message": message["interactive"]["nfm_reply"]["response_json"],
						"message_id": message["id"],
						"content_type": "flow",
						"profile_name": sender_profile_name,
					}
				).insert(ignore_permissions=True)
			elif message_type in ["image", "audio", "video", "document"]:
				settings = frappe.get_doc(
					"WhatsApp Setup",
					"WhatsApp Setup",
				)
				token = settings.get_password("token")
				url = f"{settings.url}/{settings.version}/"

				media_id = message[message_type]["id"]
				headers = {"Authorization": "Bearer " + token}
				response = requests.get(f"{url}{media_id}/", headers=headers)

				if response.status_code == 200:
					media_data = response.json()
					media_url = media_data.get("url")
					mime_type = media_data.get("mime_type")
					file_extension = mime_type.split("/")[1]

					media_response = requests.get(media_url, headers=headers)
					if media_response.status_code == 200:
						file_data = media_response.content
						file_name = f"{frappe.generate_hash(length=10)}.{file_extension}"

						message_doc = frappe.get_doc(
							{
								"doctype": "WhatsApp Chat",
								"type": "Incoming",
								"from": message["from"],
								"message_id": message["id"],
								"reply_to_message_id": reply_to_message_id,
								"is_reply": is_reply,
								"message": message[message_type].get("caption", f"/files/{file_name}"),
								"content_type": message_type,
								"profile_name": sender_profile_name,
							}
						).insert(ignore_permissions=True)

						file = frappe.get_doc(
							{
								"doctype": "File",
								"file_name": file_name,
								"attached_to_doctype": "WhatsApp Chat",
								"attached_to_name": message_doc.name,
								"content": file_data,
								"attached_to_field": "attach",
							}
						).save(ignore_permissions=True)

						message_doc.attach = file.file_url
						message_doc.save()
			elif message_type == "button":
				frappe.get_doc(
					{
						"doctype": "WhatsApp Chat",
						"type": "Incoming",
						"from": message["from"],
						"message": message["button"]["text"],
						"message_id": message["id"],
						"reply_to_message_id": reply_to_message_id,
						"is_reply": is_reply,
						"content_type": message_type,
						"profile_name": sender_profile_name,
					}
				).insert(ignore_permissions=True)
			else:
				frappe.get_doc(
					{
						"doctype": "WhatsApp Chat",
						"type": "Incoming",
						"from": message["from"],
						"message_id": message["id"],
						"message": message[message_type].get(message_type),
						"content_type": message_type,
						"profile_name": sender_profile_name,
					}
				).insert(ignore_permissions=True)

def process_message_status_updates(value):
	"""
	Process message status updates (sent, delivered, read, failed)
	Updates existing WhatsApp Chat records with status
	"""
	statuses = value.get("statuses", [])
	
	for status_data in statuses:
		try:
			update_message_status(status_data)
		except Exception as e:
			frappe.log_error(
				f"Error updating message status: {str(e)}\nStatus Data: {json.dumps(status_data)}",
				"WhatsApp Status Update Error"
			)


def update_message_status(status_data):
	"""
	Update WhatsApp Chat record with message status
	Status can be: sent, delivered, read, failed
	"""
	message_id = status_data.get("id")
	status = status_data.get("status")
	conversation = status_data.get("conversation", {}).get("id")
	recipient_id = status_data.get("recipient_id")
	
	if not message_id:
		return
	
	# Find the WhatsApp Chat record by message_id
	chat_name = frappe.db.get_value("WhatsApp Chat", {"message_id": message_id}, "name")
	
	if not chat_name:
		frappe.logger().warning(f"Message status update for unknown message_id: {message_id}")
		return
	
	# Update the status
	chat_doc = frappe.get_doc("WhatsApp Chat", chat_name)
	chat_doc.status = status
	
	if conversation:
		chat_doc.conversation_id = conversation
	
	chat_doc.save(ignore_permissions=True)
	frappe.db.commit()
	
	frappe.logger().info(f"Updated message status: {message_id} -> {status}")


def process_template_status_update(value):
	"""
	Process template status updates from Meta
	Updates WhatsApp Message Templates with approval status
	"""
	try:
		event = value.get("event")
		message_template_id = value.get("message_template_id")
		
		if not message_template_id or not event:
			return
		
		# Update template status in database
		frappe.db.sql(
			"""UPDATE `tabWhatsApp Message Templates`
			SET status = %s
			WHERE id = %s""",
			(event, message_template_id)
		)
		frappe.db.commit()
		
		frappe.logger().info(f"Updated template status: {message_template_id} -> {event}")
		
	except Exception as e:
		frappe.log_error(
			f"Error updating template status: {str(e)}\nValue: {json.dumps(value)}",
			"WhatsApp Template Status Update Error"
		)


