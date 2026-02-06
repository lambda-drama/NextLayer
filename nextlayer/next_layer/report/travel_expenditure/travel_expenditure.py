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
			"options": "\nOne Way\nReturn",
			"width": 120,
		},
		{
			"label": "Amount",
			"fieldname": "amount",
			"fieldtype": "Currency",
			"options": "currency",
			"width": 100,
		},
		{
			"label": _("Amount ({0})").format(filters.get("currency") or "USD"),
			"fieldname": "amount_converted",
			"fieldtype": "Currency",
			"width": 100,
			"options": filters.get("currency") or "USD",
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
			"label": "Currency",
			"fieldname": "currency",
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
			{"label": _("Traveller / Expense Type"), "fieldname": "name", "fieldtype": "Data", "width": 250},
			{"label": _("Amount"), "fieldname": "amount", "fieldtype": "Currency", "options": "currency", "width": 100},
			{"label": _("Amount ({0})").format(currency), "fieldname": "amount_converted", "fieldtype": "Currency", "width": 110, "options": currency},
		]
	
	if group_by == "Expense Type":
		return [
			{"label": _("Expense Type / Traveller"), "fieldname": "name", "fieldtype": "Data", "width": 250},
			{"label": _("Amount"), "fieldname": "amount", "fieldtype": "Currency", "options": "currency", "width": 100},
			{"label": _("Amount ({0})").format(currency), "fieldname": "amount_converted", "fieldtype": "Currency", "width": 100, "options": currency},
		]
	
	if group_by == "Travel Group":
		return [
			{"label": _("Travel Group / Details"), "fieldname": "name", "fieldtype": "Data", "width": 250},
			{"label": _("Amount"), "fieldname": "amount", "fieldtype": "Currency", "options": "currency", "width": 100},
			{"label": _("Amount ({0})").format(currency), "fieldname": "amount_converted", "fieldtype": "Currency", "width": 100, "options": currency},
		]
	
	return columns


def get_data(filters):
	# Main rows from Travel Expense + expenses (Travel Expense Detail)
	rows = fetch_travel_expense_rows(filters)
	if not rows:
		return []

	# More Information (Additional) amounts per Travel Expense
	more_info_map = fetch_more_information_totals()

	company_currency = None
	if filters.get("company"):
		company_currency = frappe.get_cached_value(
			"Company", filters.get("company"), "default_currency"
		) or "USD"

	presentation_currency = filters.get("currency") or "USD"
	te_more_info_applied = set()  # Apply more_info net only once per TE (avoid over-counting)
	for row in rows:
		te_name = row.get("travel_expense")
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
		row["currency"] = company_currency or row.get("currency")
		row["amount_converted"] = convert_currency(
			row["amount"], row["currency"] or company_currency, presentation_currency, row.get("booking_date")
		)

	group_by = filters.get("group_by")
	if group_by == "Traveller Name":
		rows = group_by_traveller_name_tree(rows)
	elif group_by == "Expense Type":
		rows = group_by_expense_type_tree(rows)
	elif group_by == "Travel Group":
		breakdown_by = filters.get("travel_group_breakdown_by") or "Traveller Name"
		rows = group_by_travel_group_tree(rows, breakdown_by)

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
		)
	)

	# Include all TEs (additions are in more_information child table on the original)
	# Exclude fully cancelled expenses unless user opts in
	if not filters.get("show_fully_cancelled_expenses"):
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


def group_by_traveller_name_tree(rows):
	"""
	Tree structure: parent = traveller (total), children = expense type breakdown.
	"""
	travellers = defaultdict(lambda: {"amount": 0.0, "amount_converted": 0.0, "currency": "", "children": defaultdict(lambda: {"amount": 0.0, "amount_converted": 0.0})})
	for row in rows:
		trav = row.get("traveller_name") or _("Unspecified")
		exp_type = row.get("expense_type") or _("Unspecified")
		travellers[trav]["amount"] += row.get("amount") or 0
		travellers[trav]["amount_converted"] += row.get("amount_converted") or 0
		if not travellers[trav]["currency"]:
			travellers[trav]["currency"] = row.get("currency") or ""
		travellers[trav]["children"][exp_type]["amount"] += row.get("amount") or 0
		travellers[trav]["children"][exp_type]["amount_converted"] += row.get("amount_converted") or 0

	result = []
	for trav in sorted(travellers.keys()):
		t = travellers[trav]
		# Parent row - link formatted
		parent_name = f'<a href="/app/member/{trav}">{trav}</a>' if trav != _("Unspecified") else trav
		result.append({
			"name": parent_name,
			"parent_account": "",
			"indent": 0,
			"amount": t["amount"],
			"amount_converted": t["amount_converted"],
			"currency": t["currency"],
		})
		# Child rows - link formatted
		for exp_type in sorted(t["children"].keys()):
			c = t["children"][exp_type]
			child_name = f'<a href="/app/expense-claim-type/{exp_type}">{exp_type}</a>' if exp_type != _("Unspecified") else exp_type
			result.append({
				"name": child_name,
				"parent_account": parent_name,
				"indent": 1,
				"amount": c["amount"],
				"amount_converted": c["amount_converted"],
				"currency": t["currency"],
			})
	return result


def group_by_expense_type_tree(rows):
	"""
	Tree structure: parent = expense type (total), children = traveller breakdown.
	"""
	by_type = defaultdict(lambda: {"amount": 0.0, "amount_converted": 0.0, "currency": "", "children": defaultdict(lambda: {"amount": 0.0, "amount_converted": 0.0})})
	for row in rows:
		exp_type = row.get("expense_type") or _("Unspecified")
		trav = row.get("traveller_name") or _("Unspecified")
		by_type[exp_type]["amount"] += row.get("amount") or 0
		by_type[exp_type]["amount_converted"] += row.get("amount_converted") or 0
		if not by_type[exp_type]["currency"]:
			by_type[exp_type]["currency"] = row.get("currency") or ""
		by_type[exp_type]["children"][trav]["amount"] += row.get("amount") or 0
		by_type[exp_type]["children"][trav]["amount_converted"] += row.get("amount_converted") or 0

	result = []
	for exp_type in sorted(by_type.keys()):
		t = by_type[exp_type]
		# Parent row - link formatted
		parent_name = f'<a href="/app/expense-claim-type/{exp_type}">{exp_type}</a>' if exp_type != _("Unspecified") else exp_type
		result.append({
			"name": parent_name,
			"parent_account": "",
			"indent": 0,
			"amount": t["amount"],
			"amount_converted": t["amount_converted"],
			"currency": t["currency"],
		})
		# Child rows - link formatted
		for trav in sorted(t["children"].keys()):
			c = t["children"][trav]
			child_name = f'<a href="/app/member/{trav}">{trav}</a>' if trav != _("Unspecified") else trav
			result.append({
				"name": child_name,
				"parent_account": parent_name,
				"indent": 1,
				"amount": c["amount"],
				"amount_converted": c["amount_converted"],
				"currency": t["currency"],
			})
	return result


def group_by_travel_group_tree(rows, breakdown_by="Traveller Name"):
	"""
	Tree structure: parent = travel group (total), children = breakdown by traveller or expense type.
	"""
	by_group = defaultdict(lambda: {"amount": 0.0, "amount_converted": 0.0, "currency": "", "children": defaultdict(lambda: {"amount": 0.0, "amount_converted": 0.0})})
	for row in rows:
		tg = row.get("travel_group") or _("Unspecified")
		if breakdown_by == "Traveller Name":
			child_key = row.get("traveller_name") or _("Unspecified")
		else:
			child_key = row.get("expense_type") or _("Unspecified")
		by_group[tg]["amount"] += row.get("amount") or 0
		by_group[tg]["amount_converted"] += row.get("amount_converted") or 0
		if not by_group[tg]["currency"]:
			by_group[tg]["currency"] = row.get("currency") or ""
		by_group[tg]["children"][child_key]["amount"] += row.get("amount") or 0
		by_group[tg]["children"][child_key]["amount_converted"] += row.get("amount_converted") or 0

	result = []
	for tg in sorted(by_group.keys()):
		t = by_group[tg]
		# Parent row - link formatted
		parent_name = f'<a href="/app/travel-group/{tg}">{tg}</a>' if tg != _("Unspecified") else tg
		result.append({
			"name": parent_name,
			"parent_account": "",
			"indent": 0,
			"amount": t["amount"],
			"amount_converted": t["amount_converted"],
			"currency": t["currency"],
		})
		# Child rows - link formatted based on breakdown
		for child_key in sorted(t["children"].keys()):
			c = t["children"][child_key]
			if breakdown_by == "Traveller Name":
				child_name = f'<a href="/app/member/{child_key}">{child_key}</a>' if child_key != _("Unspecified") else child_key
			else:
				child_name = f'<a href="/app/expense-claim-type/{child_key}">{child_key}</a>' if child_key != _("Unspecified") else child_key
			result.append({
				"name": child_name,
				"parent_account": parent_name,
				"indent": 1,
				"amount": c["amount"],
				"amount_converted": c["amount_converted"],
				"currency": t["currency"],
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