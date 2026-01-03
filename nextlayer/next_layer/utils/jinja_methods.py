# Copyright (c) 2025, jr@gmail.com and contributors
# For license information, please see license.txt

import re
from nextlayer.next_layer.controllers.generate_qrcode import get_invoice_qr_code_url

__all__ = ['get_invoice_qr_code_url', 'extract_image_src_from_html']


def extract_image_src_from_html(html_content):
	"""
	Extract the first image src from HTML content.
	
	Args:
		html_content: HTML string containing image tags
		
	Returns:
		str: Image src URL or empty string if not found
	"""
	if not html_content:
		return ""
	
	# Use regex to find img src
	pattern = r'<img[^>]+src=["\']([^"\']+)["\']'
	match = re.search(pattern, html_content, re.IGNORECASE)
	
	if match:
		return match.group(1)
	
	return ""

