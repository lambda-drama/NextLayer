# Copyright (c) 2026, Next Layer and contributors
# For license information, please see license.txt

import re
import frappe


REVISION_SUFFIX_MAP = {
	"After Site Visit": "-2",
	"Price Adjustment": "-4",
	"Final Quote": "-3",
}


def set_quotation_name(doc, event=None):
    
	"""
	Set Quotation name before insert:
	- Initial Quote: {company_abbr}-00001, {company_abbr}-00002, ...
	- After Site Visit: {parent_name}-2  (e.g. BR-00001-2)
	- Final Quote: {parent_name}-3       (e.g. BR-00001-3)
	- Price Adjustment: {parent_name}-4  (e.g. BR-00001-4)
	"""
	if not doc.get("__islocal") or doc.get("name"):
		return
	
	company = doc.get("company")
	if not company:
		return
	abbr = frappe.db.get_value("Company", company, "abbr") or company[:2].upper()
	revision_type = doc.get("custom_revision_type") or "Initial Quote"
	parent_quotation = doc.get("custom_parent_quotation")

	if revision_type in REVISION_SUFFIX_MAP and parent_quotation:
		suffix = REVISION_SUFFIX_MAP[revision_type]
		if not frappe.db.exists("Quotation", parent_quotation):
			frappe.throw(frappe._("Parent Quotation {0} does not exist.").format(parent_quotation))
		doc.name = parent_quotation + suffix
		return
	
	# Initial Quote: get next sequence for this company
	doc.name = _get_next_initial_quotation_name(company, abbr)
	


def _get_next_initial_quotation_name(company, abbr):
	"""Get next name in series: BR-00001, BR-00002, ..."""
	# All quotation names for this company that look like ABBR-XXXXX or ABBR-XXXXX-2 etc.
	pattern = re.escape(abbr) + r"-(\d{1,10})(?:-\d+)?$"
	names = frappe.get_all(
		"Quotation",
		filters={"company": company},
		pluck="name",
	)
	max_seq = 0
	for name in names:
		m = re.match(pattern, name, re.IGNORECASE)
		if m:
			max_seq = max(max_seq, int(m.group(1)))
	next_seq = max_seq + 1
	return f"{abbr}-{next_seq:05d}"
