# Copyright (c) 2026, jr@gmail.com and contributors
# For license information, please see license.txt

from collections import defaultdict
import frappe
from frappe.utils import getdate
from frappe import _
from frappe.query_builder import DocType


def execute(filters=None):
	columns = get_columns(filters)
	data = get_data(filters)
	return columns, data


def get_columns(filters):
	columns = [
		{
			"label": "Travel Expense",
			"fieldname": "travel_expense",
			"fieldtype": "Link",
			"options": "Travel Expense",
			"width": 150,
		},
		{
			"label": "Date of Booking",
			"fieldname": "booking_date",
			"fieldtype": "Date",
			"width": 120,
		},
		{
			"label": "Traveller Name",
			"fieldname": "traveller_name",
			"fieldtype": "Link",
			"options": "Member",
			"width": 150,
		},
		{
			"label": "Travel Group",
			"fieldname": "travel_group",
			"fieldtype": "Link",
			"options": "Travel Group",
			"width": 150,
		},
		{
			"label": "Expense Type",
			"fieldname": "expense_type",
			"fieldtype": "Link",
			"options": "Expense Claim Type",
			"width": 120,
		},
		{
			"label": "Type of Travel",
			"fieldname": "travel_type",
			"fieldtype": "Select",
			"options": "\nOne Way\nReturn\nMulti-city",
			"width": 120,
		},
		{
			"label": _("Amount ({0})").format(filters.get("currency") or "USD"),
			"fieldname": "amount_converted",
			"fieldtype": "Currency",
			"width": 100,
			"options": filters.get("currency") or "USD",
		},
		{
			"label": "Amount (Company Currency)",
			"fieldname": "amount_company_currency",
			"fieldtype": "Currency",
			"width": 140,
			"options": "company_currency",
		},
		{
			"label": "Attachment",
			"fieldname": "attachment",
			"fieldtype": "Data",
			"width": 180,
		},
		{
			"label": "Company Group",
			"fieldname": "company_group",
			"fieldtype": "Link",
			"options": "Company Group",
			"width": 150,
		},
		{
			"label": "Airline",
			"fieldname": "airline",
			"fieldtype": "Link",
			"options": "Airlines",
			"width": 150,
		},
		{
			"label": "Departure Date",
			"fieldname": "departure_date",
			"fieldtype": "Date",
			"width": 120,
		},
		{
			"label": "Departure Airport",
			"fieldname": "departure_airport",
			"fieldtype": "Link",
			"options": "Airport",
			"width": 150,
		},
		{
			"label": "Arrival Date",
			"fieldname": "arrival_date",
			"fieldtype": "Date",
			"width": 120,
		},
		{
			"label": "Arrival Airport",
			"fieldname": "arrival_airport",
			"fieldtype": "Link",
			"options": "Airport",
			"width": 150,
		},
		{
			"label": "Booked By",
			"fieldname": "booked_by",
			"fieldtype": "Link",
			"options": "Member",
			"width": 150,
		},
		{
			"label": "Voucher No",
			"fieldname": "voucher_no",
			"fieldtype": "Data",
			"width": 150,
		},
		{
			"label": "Additional / More Info",
			"fieldname": "additional_info",
			"fieldtype": "Data",
			"width": 150,
		},
		{
			"label": "Check-in Date",
			"fieldname": "hotel_checkin_date",
			"fieldtype": "Date",
			"width": 110,
		},
		{
			"label": "Check-out Date",
			"fieldname": "hotel_checkout_date",
			"fieldtype": "Date",
			"width": 110,
		},
		{
			"label": "Days",
			"fieldname": "hotel_days",
			"fieldtype": "Int",
			"width": 60,
		},
		{
			"label": "Hotel Name",
			"fieldname": "hotel_name",
			"fieldtype": "Data",
			"width": 150,
		},
		{
			"label": "Hotel Location",
			"fieldname": "hotel_location",
			"fieldtype": "Link",
			"options": "Location",
			"width": 130,
		},
		{
			"label": "Country",
			"fieldname": "hotel_country",
			"fieldtype": "Data",
			"width": 100,
		},
		{
			"label": "Currency",
			"fieldname": "currency",
			"fieldtype": "Link",
			"options": "Currency",
			"width": 100,
			"hidden": 1,
		},
		{
			"label": "Company Currency",
			"fieldname": "company_currency",
			"fieldtype": "Link",
			"options": "Currency",
			"width": 100,
			"hidden": 1,
		},
	]

	group_by = filters.get("group_by")
	currency = filters.get("currency") or "USD"

	if group_by == "Traveller Name":
		return [
			{"label": _("Traveller / Expense Type / Transaction"), "fieldname": "name", "fieldtype": "Data", "width": 250},
			{"label": _("Amount ({0})").format(currency), "fieldname": "amount_converted", "fieldtype": "Currency", "width": 110, "options": currency},
			{"label": "Amount (Company Currency)", "fieldname": "amount_company_currency", "fieldtype": "Currency", "width": 150, "options": "company_currency"},
			{"label": "Departure Airport", "fieldname": "departure_airport", "fieldtype": "Data", "width": 140},
			{"label": "Arrival Airport", "fieldname": "arrival_airport", "fieldtype": "Data", "width": 140},
			{"label": "Airline", "fieldname": "airline", "fieldtype": "Data", "width": 120},
			{"label": "Travel Type", "fieldname": "travel_type", "fieldtype": "Data", "width": 100},
			{"label": "Voucher No", "fieldname": "voucher_no", "fieldtype": "Data", "width": 120},
			{"label": "Booked By", "fieldname": "booked_by", "fieldtype": "Data", "width": 120},
			{"label": "Check-in Date", "fieldname": "hotel_checkin_date", "fieldtype": "Data", "width": 110},
			{"label": "Check-out Date", "fieldname": "hotel_checkout_date", "fieldtype": "Data", "width": 110},
			{"label": "Days", "fieldname": "hotel_days", "fieldtype": "Data", "width": 60},
			{"label": "Hotel Name", "fieldname": "hotel_name", "fieldtype": "Data", "width": 150},
			{"label": "Hotel Location", "fieldname": "hotel_location", "fieldtype": "Data", "width": 130},
			{"label": "Country", "fieldname": "hotel_country", "fieldtype": "Data", "width": 100},
			{"label": "Company Currency", "fieldname": "company_currency", "fieldtype": "Link", "options": "Currency", "width": 100, "hidden": 1},
		]

	if group_by == "Expense Type":
		return [
			{"label": _("Expense Type / Traveller"), "fieldname": "name", "fieldtype": "Data", "width": 250},
			{"label": _("Amount ({0})").format(currency), "fieldname": "amount_converted", "fieldtype": "Currency", "width": 110, "options": currency},
			{"label": "Amount (Company Currency)", "fieldname": "amount_company_currency", "fieldtype": "Currency", "width": 150, "options": "company_currency"},
			{"label": "Company Currency", "fieldname": "company_currency", "fieldtype": "Link", "options": "Currency", "width": 100, "hidden": 1},
		]

	if group_by == "Travel Group":
		return [
			{"label": _("Travel Group / Details / Transaction"), "fieldname": "name", "fieldtype": "Data", "width": 250},
			{"label": _("Amount ({0})").format(currency), "fieldname": "amount_converted", "fieldtype": "Currency", "width": 110, "options": currency},
			{"label": "Amount (Company Currency)", "fieldname": "amount_company_currency", "fieldtype": "Currency", "width": 150, "options": "company_currency"},
			{"label": "Company Currency", "fieldname": "company_currency", "fieldtype": "Link", "options": "Currency", "width": 100, "hidden": 1},
		]

	if group_by == "Company":
		return [
			{"label": _("Company / Details / Transaction"), "fieldname": "name", "fieldtype": "Data", "width": 250},
			{"label": _("Amount ({0})").format(currency), "fieldname": "amount_converted", "fieldtype": "Currency", "width": 110, "options": currency},
			{"label": "Amount (Company Currency)", "fieldname": "amount_company_currency", "fieldtype": "Currency", "width": 150, "options": "company_currency"},
			{"label": "Company Currency", "fieldname": "company_currency", "fieldtype": "Link", "options": "Currency", "width": 100, "hidden": 1},
		]

	return columns


def get_data(filters):
	# Main rows from Travel Expense + expenses (Travel Expense Detail)
	rows = fetch_travel_expense_rows(filters)
	if not rows:
		return []

	# Attachments per Travel Expense
	attachment_map = fetch_attachments_for_travel_expenses([r.get("travel_expense") for r in rows if r.get("travel_expense")])

	# More Information (Additional) amounts per Travel Expense
	more_info_map = fetch_more_information_totals()

	# Get company currency for each row based on the company in the row
	presentation_currency = filters.get("currency") or "USD"
	te_more_info_applied = set()  # Apply more_info net only once per TE (avoid over-counting)
	
	for row in rows:
		te_name = row.get("travel_expense")
		row["attachment"] = attachment_map.get(te_name)
		
		# Get the company currency from the row's company
		row_company = row.get("company")
		if row_company:
			row["company_currency"] = frappe.get_cached_value("Company", row_company, "default_currency") or "USD"
		else:
			row["company_currency"] = "USD"
		
		if row.get("amount_company_currency") is None:
			row["amount_company_currency"] = row.get("amount")
		
		more_list = more_info_map.get(te_name, [])
		# Additional = add to total; Refund = subtract (money returned)
		more_info_net = 0
		if te_name not in te_more_info_applied and more_list:
			te_more_info_applied.add(te_name)
			for m in more_list:
				amt = m.get("amount") or 0
				if (m.get("entry_type") or "").strip() == "Refund":
					more_info_net -= amt
				else:
					more_info_net += amt
		# Refund docs (separate TE with refund=1): amount represents money returned, show as negative
		base_amount = row.get("amount") or 0
		if row.get("is_refund"):
			base_amount = -abs(base_amount)
		row["amount"] = base_amount + more_info_net
		row["additional_info"] = ", ".join(m.get("entry_type", "") + " " + (m.get("journal_entry") or "") for m in more_list) if more_list else None
		row["currency"] = row.get("currency") or row["company_currency"]
		row["amount_converted"] = convert_currency(
			row["amount"], row["currency"], presentation_currency, row.get("booking_date")
		)

	group_by = filters.get("group_by")
	if group_by == "Traveller Name":
		rows = group_by_traveller_name_tree(rows)
	elif group_by == "Expense Type":
		rows = group_by_expense_type_tree(rows)
	elif group_by == "Travel Group":
		breakdown_by = filters.get("travel_group_breakdown_by") or "Traveller Name"
		rows = group_by_travel_group_tree(rows, breakdown_by)
	elif group_by == "Company":
		breakdown_by = filters.get("company_breakdown_by") or "Travel Group"
		rows = group_by_company_tree(rows, breakdown_by)

	# Add custom total row at bottom (in presentation currency)
	total = 0
	total_company_currency = 0
	if group_by:
		# In tree views, sum only top-level nodes to avoid double-counting children
		for r in rows:
			if (r.get("indent") or 0) == 0:
				total += r.get("amount_converted") or 0
				total_company_currency += r.get("amount_company_currency") or 0
	else:
		for r in rows:
			total += r.get("amount_converted") or 0
			total_company_currency += r.get("amount_company_currency") or 0

	if rows:
		# Get company currency for total row
		company_for_display = filters.get("company") or frappe.defaults.get_user_default("Company")
		total_company_currency_code = "USD"
		if company_for_display:
			total_company_currency_code = frappe.get_cached_value("Company", company_for_display, "default_currency") or "USD"
		
		# Set Amount (Company Currency) to 0 if:
		# 1. No company selected in filters, OR
		# 2. Grouped by Company (different companies have different currencies)
		if not filters.get("company") or group_by == "Company":
			total_company_currency = 0
		
		total_row = {
			"name": _("Total"),
			"account": _("Total"),
			"account_name": _("Total"),
			"travel_expense": _("Total"),
			"amount_converted": total,
			"amount_company_currency": total_company_currency,
			"company_currency": total_company_currency_code,
			"bold": 1,
		}
		if group_by and company_for_display:
			total_row["company"] = company_for_display
		rows.append(total_row)

	return rows


def fetch_travel_expense_rows(filters):
	TE = DocType("Travel Expense")
	TED = DocType("Travel Expense Detail")

	query = (
		frappe.qb.from_(TED)
		.join(TE)
		.on(TE.name == TED.parent)
		.select(
			TE.name.as_("travel_expense"),
			TED.expense_date.as_("booking_date"),
			TE.company.as_("company"),
			TE.travel_group.as_("travel_group"),
			TE.traveler_name.as_("traveller_name"),
			TED.expense_type.as_("expense_type"),
			TED.amount.as_("amount"),
			TED.amount_company_currency.as_("amount_company_currency"),
			TE.refund.as_("is_refund"),
			TE.company_group.as_("company_group"),
			TED.custom_airlines.as_("airline"),
			TED.custom_date_of_travel.as_("departure_date"),
			TED.custom_departure_airport.as_("departure_airport"),
			TED.custom_date_of_arrival.as_("arrival_date"),
			TED.custom_arrival_airport.as_("arrival_airport"),
			TED.custom_booked_by.as_("booked_by"),
			TED.custom_travel_type.as_("travel_type"),
			TED.custom_prn_number.as_("voucher_no"),
			TE.currency.as_("currency"),
			TED.hotel_checkin_date.as_("hotel_checkin_date"),
			TED.hotel_checkout_date.as_("hotel_checkout_date"),
			TED.hotel_days.as_("hotel_days"),
			TED.custom_hotel_name.as_("hotel_name"),
			TED.hotel_location.as_("hotel_location"),
			TED.hotel_country.as_("hotel_country"),
		)
	)

	# Include all TEs (additions are in more_information child table on the original)
	# Cancellation behaviour:
	# - By default: show only NOT cancelled (is_cancelled = 0 or null)
	# - If "Show Fully Cancelled Expenses" is ticked: show ONLY fully cancelled (is_cancelled = 1)
	if filters.get("show_fully_cancelled_expenses"):
		query = query.where(TE.is_cancelled == 1)
	else:
		query = query.where((TE.is_cancelled == 0) | (TE.is_cancelled.isnull()))

	# Only include submitted Travel Expenses (exclude Draft and Cancelled docstatus)
	query = query.where(TE.docstatus == 1)

	if filters.get("company"):
		query = query.where(TE.company == filters["company"])
	if filters.get("company_group"):
		query = query.where(TE.company_group == filters["company_group"])
	if filters.get("booked_by"):
		query = query.where(TED.custom_booked_by == filters["booked_by"])
	if filters.get("travel_expense"):
		query = query.where(TE.name == filters["travel_expense"])
	if filters.get("traveller_name"):
		query = query.where(TE.traveler_name == filters["traveller_name"])
	if filters.get("travel_type"):
		query = query.where(TED.custom_travel_type == filters["travel_type"])
	if filters.get("from_date") and filters.get("to_date"):
		query = query.where(
			TE.posting_date.between(
				getdate(filters["from_date"]), getdate(filters["to_date"])
			)
		)

	query = query.orderby(TE.posting_date, order=frappe.qb.desc)
	return query.run(as_dict=True)


def fetch_more_information_totals():
	"""Return per parent Travel Expense: list of more_information rows (Additional/Refund) with amount and journal_entry."""
	TM = DocType("Travel Expense More Information")
	data = (
		frappe.qb.from_(TM)
		.select(
			TM.parent,
			TM.entry_type,
			TM.amount,
			TM.journal_entry,
		)
		.where(TM.amount != 0)
		.run(as_dict=True)
	)
	by_parent = defaultdict(list)
	for row in data:
		by_parent[row["parent"]].append(row)
	return dict(by_parent)


def fetch_attachments_for_travel_expenses(te_names):
	"""Return mapping of Travel Expense name -> HTML link(s) to attachment(s)."""
	if not te_names:
		return {}
	te_names = list(set(n for n in te_names if n))
	files = frappe.get_all(
		"File",
		filters={
			"attached_to_doctype": "Travel Expense",
			"attached_to_name": ["in", te_names],
		},
		fields=["attached_to_name", "file_name", "file_url"],
		order_by="attached_to_name, creation",
	)
	by_te = defaultdict(list)
	for f in files:
		link = f'<a href="{f.get("file_url") or "#"}" target="_blank">{f.get("file_name") or "Attachment"}</a>'
		by_te[f["attached_to_name"]].append(link)
	return {te: ", ".join(links) if links else None for te, links in by_te.items()}


def _collect_unique(items):
	"""Collect unique non-empty values and join."""
	seen = set()
	out = []
	for x in (items or []):
		if x and str(x).strip() and x not in seen:
			seen.add(x)
			out.append(str(x))
	return ", ".join(out) if out else None


def group_by_traveller_name_tree(rows):
	"""
	3-level tree structure: 
	Level 1 (parent): Traveller Name (total) - amounts only
	Level 2 (child): Expense Type breakdown - amounts only
	Level 3 (grandchild): Individual transactions - all details
	"""
	travellers = defaultdict(lambda: {
		"amount": 0.0, "amount_converted": 0.0, "amount_company_currency": 0.0,
		"company_currency": "",
		"children": defaultdict(lambda: {
			"amount": 0.0, "amount_converted": 0.0, "amount_company_currency": 0.0,
			"transactions": [],  # Store individual transactions
		}),
	})
	
	for row in rows:
		trav = row.get("traveller_name") or _("Unspecified")
		exp_type = row.get("expense_type") or _("Unspecified")
		t = travellers[trav]
		amt_cc = row.get("amount_company_currency") or row.get("amount") or 0
		t["amount"] += row.get("amount") or 0
		t["amount_converted"] += row.get("amount_converted") or 0
		t["amount_company_currency"] += amt_cc
		if not t["company_currency"]:
			t["company_currency"] = row.get("company_currency") or "USD"
		
		c = t["children"][exp_type]
		c["amount"] += row.get("amount") or 0
		c["amount_converted"] += row.get("amount_converted") or 0
		c["amount_company_currency"] += amt_cc
		
		# Store the transaction for level 3
		c["transactions"].append(row)

	result = []
	for trav in sorted(travellers.keys()):
		t = travellers[trav]
		parent_name = f'<a href="/app/member/{trav}">{trav}</a>' if trav != _("Unspecified") else trav
		# Level 1: Traveller (Parent) - BOLD, amounts only
		result.append({
			"name": parent_name,
			"parent_account": "",
			"indent": 0,
			"amount": t["amount"],
			"amount_converted": t["amount_converted"],
			"amount_company_currency": t["amount_company_currency"],
			"company_currency": t["company_currency"],
			# No travel details at parent level
			"departure_airport": "",
			"arrival_airport": "",
			"airline": "",
			"travel_type": "",
			"voucher_no": "",
			"booked_by": "",
			"hotel_checkin_date": "",
			"hotel_checkout_date": "",
			"hotel_days": "",
			"hotel_name": "",
			"hotel_location": "",
			"hotel_country": "",
			"bold": 1,
		})
		
		for exp_type in sorted(t["children"].keys()):
			c = t["children"][exp_type]
			child_name = f'<a href="/app/expense-claim-type/{exp_type}">{exp_type}</a>' if exp_type != _("Unspecified") else exp_type
			# Level 2: Expense Type (Child) - BOLD, amounts only
			result.append({
				"name": child_name,
				"parent_account": parent_name,
				"indent": 1,
				"amount": c["amount"],
				"amount_converted": c["amount_converted"],
				"amount_company_currency": c["amount_company_currency"],
				"company_currency": t["company_currency"],
				# No travel details at child level
				"departure_airport": "",
				"arrival_airport": "",
				"airline": "",
				"travel_type": "",
				"voucher_no": "",
				"booked_by": "",
				"hotel_checkin_date": "",
				"hotel_checkout_date": "",
				"hotel_days": "",
				"hotel_name": "",
				"hotel_location": "",
				"hotel_country": "",
				"bold": 1,
			})
			
			# Level 3: Individual Transactions (Grandchild) - ALL DETAILS
			for transaction in c["transactions"]:
				te_name = transaction.get("travel_expense") or ""
				transaction_display = f'<a href="/app/travel-expense/{te_name}">{te_name}</a>' if te_name else _("Transaction")
				result.append({
					"name": transaction_display,
					"parent_account": child_name,
					"indent": 2,
					"amount": transaction.get("amount") or 0,
					"amount_converted": transaction.get("amount_converted") or 0,
					"amount_company_currency": transaction.get("amount_company_currency") or 0,
					"company_currency": transaction.get("company_currency") or "USD",
					# Show all travel details at transaction level
					"departure_airport": transaction.get("departure_airport") or "",
					"arrival_airport": transaction.get("arrival_airport") or "",
					"airline": transaction.get("airline") or "",
					"travel_type": transaction.get("travel_type") or "",
					"voucher_no": transaction.get("voucher_no") or "",
					"booked_by": transaction.get("booked_by") or "",
					"hotel_checkin_date": str(transaction.get("hotel_checkin_date")) if transaction.get("hotel_checkin_date") else "",
					"hotel_checkout_date": str(transaction.get("hotel_checkout_date")) if transaction.get("hotel_checkout_date") else "",
					"hotel_days": str(transaction.get("hotel_days")) if transaction.get("hotel_days") is not None else "",
					"hotel_name": transaction.get("hotel_name") or "",
					"hotel_location": transaction.get("hotel_location") or "",
					"hotel_country": transaction.get("hotel_country") or "",
				})
	
	return result


def group_by_expense_type_tree(rows):
	"""
	Tree structure: parent = expense type (total), children = traveller breakdown.
	"""
	by_type = defaultdict(lambda: {
		"amount": 0.0, "amount_converted": 0.0, "amount_company_currency": 0.0,
		"company_currency": "", "children": defaultdict(lambda: {"amount": 0.0, "amount_converted": 0.0, "amount_company_currency": 0.0})
	})
	for row in rows:
		exp_type = row.get("expense_type") or _("Unspecified")
		trav = row.get("traveller_name") or _("Unspecified")
		amt_cc = row.get("amount_company_currency") or row.get("amount") or 0
		by_type[exp_type]["amount"] += row.get("amount") or 0
		by_type[exp_type]["amount_converted"] += row.get("amount_converted") or 0
		by_type[exp_type]["amount_company_currency"] += amt_cc
		if not by_type[exp_type]["company_currency"]:
			by_type[exp_type]["company_currency"] = row.get("company_currency") or "USD"
		by_type[exp_type]["children"][trav]["amount"] += row.get("amount") or 0
		by_type[exp_type]["children"][trav]["amount_converted"] += row.get("amount_converted") or 0
		by_type[exp_type]["children"][trav]["amount_company_currency"] += amt_cc

	result = []
	for exp_type in sorted(by_type.keys()):
		t = by_type[exp_type]
		parent_name = f'<a href="/app/expense-claim-type/{exp_type}">{exp_type}</a>' if exp_type != _("Unspecified") else exp_type
		result.append({
			"name": parent_name,
			"parent_account": "",
			"indent": 0,
			"amount": t["amount"],
			"amount_converted": t["amount_converted"],
			"amount_company_currency": t["amount_company_currency"],
			"company_currency": t["company_currency"],
			"bold": 1,  # Make parent bold
		})
		for trav in sorted(t["children"].keys()):
			c = t["children"][trav]
			child_name = f'<a href="/app/member/{trav}">{trav}</a>' if trav != _("Unspecified") else trav
			result.append({
				"name": child_name,
				"parent_account": parent_name,
				"indent": 1,
				"amount": c["amount"],
				"amount_converted": c["amount_converted"],
				"amount_company_currency": c["amount_company_currency"],
				"company_currency": t["company_currency"],
			})
	return result


def group_by_travel_group_tree(rows, breakdown_by="Traveller Name"):
	"""
	3-level tree structure:
	Level 1 (parent): Travel Group (total)
	Level 2 (child): Traveller Name or Expense Type
	Level 3 (grandchild): Individual transactions
	"""
	by_group = defaultdict(lambda: {
		"amount": 0.0, "amount_converted": 0.0, "amount_company_currency": 0.0,
		"company_currency": "", 
		"children": defaultdict(lambda: {
			"amount": 0.0, "amount_converted": 0.0, "amount_company_currency": 0.0,
			"transactions": []
		})
	})
	
	for row in rows:
		tg = row.get("travel_group") or _("Unspecified")
		if breakdown_by == "Traveller Name":
			child_key = row.get("traveller_name") or _("Unspecified")
		else:
			child_key = row.get("expense_type") or _("Unspecified")
		amt_cc = row.get("amount_company_currency") or row.get("amount") or 0
		by_group[tg]["amount"] += row.get("amount") or 0
		by_group[tg]["amount_converted"] += row.get("amount_converted") or 0
		by_group[tg]["amount_company_currency"] += amt_cc
		if not by_group[tg]["company_currency"]:
			by_group[tg]["company_currency"] = row.get("company_currency") or "USD"
		by_group[tg]["children"][child_key]["amount"] += row.get("amount") or 0
		by_group[tg]["children"][child_key]["amount_converted"] += row.get("amount_converted") or 0
		by_group[tg]["children"][child_key]["amount_company_currency"] += amt_cc
		by_group[tg]["children"][child_key]["transactions"].append(row)

	result = []
	for tg in sorted(by_group.keys()):
		t = by_group[tg]
		parent_name = f'<a href="/app/travel-group/{tg}">{tg}</a>' if tg != _("Unspecified") else tg
		# Level 1: Travel Group (Parent) - BOLD
		result.append({
			"name": parent_name,
			"parent_account": "",
			"indent": 0,
			"amount": t["amount"],
			"amount_converted": t["amount_converted"],
			"amount_company_currency": t["amount_company_currency"],
			"company_currency": t["company_currency"],
			"bold": 1,  # Make parent bold
		})
		
		for child_key in sorted(t["children"].keys()):
			c = t["children"][child_key]
			if breakdown_by == "Traveller Name":
				child_name = f'<a href="/app/member/{child_key}">{child_key}</a>' if child_key != _("Unspecified") else child_key
			else:
				child_name = f'<a href="/app/expense-claim-type/{child_key}">{child_key}</a>' if child_key != _("Unspecified") else child_key
			
			# Level 2: Traveller/Expense Type (Child) - BOLD
			result.append({
				"name": child_name,
				"parent_account": parent_name,
				"indent": 1,
				"amount": c["amount"],
				"amount_converted": c["amount_converted"],
				"amount_company_currency": c["amount_company_currency"],
				"company_currency": t["company_currency"],
				"bold": 1,  # Make child bold
			})
			
			# Level 3: Individual Transactions (Grandchild)
			for transaction in c["transactions"]:
				te_name = transaction.get("travel_expense") or ""
				transaction_display = f'<a href="/app/travel-expense/{te_name}">{te_name}</a>' if te_name else _("Transaction")
				result.append({
					"name": transaction_display,
					"parent_account": child_name,
					"indent": 2,
					"amount": transaction.get("amount") or 0,
					"amount_converted": transaction.get("amount_converted") or 0,
					"amount_company_currency": transaction.get("amount_company_currency") or 0,
					"company_currency": transaction.get("company_currency") or "USD",
				})
	
	return result


def group_by_company_tree(rows, breakdown_by="Travel Group"):
	"""
	3-level tree structure:
	Level 1 (parent): Company (total)
	Level 2 (child): Travel Group, Traveller Name, or Expense Type
	Level 3 (grandchild): Individual transactions
	"""
	by_company = defaultdict(lambda: {
		"amount": 0.0, "amount_converted": 0.0, "amount_company_currency": 0.0,
		"company_currency": "", 
		"children": defaultdict(lambda: {
			"amount": 0.0, "amount_converted": 0.0, "amount_company_currency": 0.0,
			"transactions": []
		}),
	})
	
	for row in rows:
		company = row.get("company") or _("Unspecified")
		if breakdown_by == "Travel Group":
			child_key = row.get("travel_group") or _("Unspecified")
		elif breakdown_by == "Traveller Name":
			child_key = row.get("traveller_name") or _("Unspecified")
		else:
			child_key = row.get("expense_type") or _("Unspecified")
		amt_cc = row.get("amount_company_currency") or row.get("amount") or 0
		by_company[company]["amount"] += row.get("amount") or 0
		by_company[company]["amount_converted"] += row.get("amount_converted") or 0
		by_company[company]["amount_company_currency"] += amt_cc
		if not by_company[company]["company_currency"]:
			by_company[company]["company_currency"] = row.get("company_currency") or "USD"
		by_company[company]["children"][child_key]["amount"] += row.get("amount") or 0
		by_company[company]["children"][child_key]["amount_converted"] += row.get("amount_converted") or 0
		by_company[company]["children"][child_key]["amount_company_currency"] += amt_cc
		by_company[company]["children"][child_key]["transactions"].append(row)

	result = []
	for company in sorted(by_company.keys()):
		t = by_company[company]
		parent_name = f'<a href="/app/company/{company}">{company}</a>' if company != _("Unspecified") else company
		# Level 1: Company (Parent) - BOLD
		result.append({
			"name": parent_name,
			"parent_account": "",
			"indent": 0,
			"amount": t["amount"],
			"amount_converted": t["amount_converted"],
			"amount_company_currency": t["amount_company_currency"],
			"company_currency": t["company_currency"],
			"bold": 1,  # Make parent bold
		})
		
		for child_key in sorted(t["children"].keys()):
			c = t["children"][child_key]
			if breakdown_by == "Travel Group":
				child_name = f'<a href="/app/travel-group/{child_key}">{child_key}</a>' if child_key != _("Unspecified") else child_key
			elif breakdown_by == "Traveller Name":
				child_name = f'<a href="/app/member/{child_key}">{child_key}</a>' if child_key != _("Unspecified") else child_key
			else:
				child_name = f'<a href="/app/expense-claim-type/{child_key}">{child_key}</a>' if child_key != _("Unspecified") else child_key
			
			# Level 2: Travel Group/Traveller/Expense Type (Child) - BOLD
			result.append({
				"name": child_name,
				"parent_account": parent_name,
				"indent": 1,
				"amount": c["amount"],
				"amount_converted": c["amount_converted"],
				"amount_company_currency": c["amount_company_currency"],
				"company_currency": t["company_currency"],
				"bold": 1,  # Make child bold
			})
			
			# Level 3: Individual Transactions (Grandchild)
			for transaction in c["transactions"]:
				te_name = transaction.get("travel_expense") or ""
				transaction_display = f'<a href="/app/travel-expense/{te_name}">{te_name}</a>' if te_name else _("Transaction")
				result.append({
					"name": transaction_display,
					"parent_account": child_name,
					"indent": 2,
					"amount": transaction.get("amount") or 0,
					"amount_converted": transaction.get("amount_converted") or 0,
					"amount_company_currency": transaction.get("amount_company_currency") or 0,
					"company_currency": transaction.get("company_currency") or "USD",
				})
	
	return result


def convert_currency(amount, from_currency, to_currency, date):
	if not amount:
		return 0
	rate, _ = get_conversion_rate(from_currency, to_currency, date)
	return amount * rate


def get_conversion_rate(from_currency, to_currency, date):
	if not from_currency or not to_currency or from_currency == to_currency:
		return 1, None
	rates = frappe.get_all(
		"Currency Exchange",
		filters={
			"from_currency": from_currency,
			"to_currency": to_currency,
			"date": ["<=", date],
		},
		fields=["exchange_rate", "date"],
		order_by="date desc",
		limit=1,
	)
	if rates:
		return rates[0]["exchange_rate"], rates[0]["date"]
	inv = frappe.get_all(
		"Currency Exchange",
		filters={
			"from_currency": to_currency,
			"to_currency": from_currency,
			"date": ["<=", date],
		},
		fields=["exchange_rate", "date"],
		order_by="date desc",
		limit=1,
	)
	if inv:
		return 1 / inv[0]["exchange_rate"], inv[0]["date"]
	return 1, None
