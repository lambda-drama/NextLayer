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
			"label": "Amount (USD)",
			"fieldname": "amount_usd",
			"fieldtype": "Currency",
			"width": 100,
			"options": "USD",
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

	if filters.get("group_by") == "Traveller Name":
		return [columns[2], columns[5], columns[6]]
	if filters.get("group_by") == "Hotel":
		return [columns[3], columns[5], columns[6]]  # Expense Type, Amount, Amount (USD)
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

	for row in rows:
		te_name = row.get("travel_expense")
		more_list = more_info_map.get(te_name, [])
		additional_total = sum(m["amount"] for m in more_list)
		row["amount"] = (row.get("amount") or 0) + additional_total
		row["additional_info"] = ", ".join(m.get("entry_type", "") + " " + (m.get("journal_entry") or "") for m in more_list) if more_list else None
		row["currency"] = company_currency or row.get("currency")
		row["amount_usd"] = convert_currency(
			row["amount"], row["currency"] or company_currency, "USD", row.get("booking_date")
		)

	if filters.get("group_by") == "Traveller Name":
		rows = group_by_traveller_name(rows)
	elif filters.get("group_by") == "Hotel":
		rows = group_by_expense_type(rows)

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
			TE.traveler_name.as_("traveller_name"),
			TED.expense_type.as_("expense_type"),
			TED.amount.as_("amount"),
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

	# Exclude addition-only docs if we ever have is_addition on Travel Expense
	query = query.where((TE.is_addition == 0) | (TE.is_addition.isnull()))

	if filters.get("company"):
		query = query.where(TE.company == filters["company"])
	if filters.get("company_group"):
		query = query.where(TE.company_group == filters["company_group"])
	if filters.get("booked_by"):
		query = query.where(TED.custom_booked_by == filters["booked_by"])
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


def group_by_traveller_name(rows):
	travellers_map = defaultdict(
		lambda: {"traveller_name": "", "amount": 0.0, "amount_usd": 0.0, "currency": ""}
	)
	for row in rows:
		key = row.get("traveller_name") or ""
		travellers_map[key]["traveller_name"] = row.get("traveller_name")
		travellers_map[key]["amount"] += row.get("amount") or 0
		travellers_map[key]["amount_usd"] += row.get("amount_usd") or 0
		if not travellers_map[key]["currency"]:
			travellers_map[key]["currency"] = row.get("currency")
	return list(travellers_map.values())


def group_by_expense_type(rows):
	"""Group by expense type (Travel, Hotel, Visa, etc.); shows Expense Type, Amount, Amount (USD)."""
	by_type = defaultdict(
		lambda: {"expense_type": "", "amount": 0.0, "amount_usd": 0.0, "currency": ""}
	)
	for row in rows:
		key = row.get("expense_type") or ""
		by_type[key]["expense_type"] = row.get("expense_type")
		by_type[key]["amount"] += row.get("amount") or 0
		by_type[key]["amount_usd"] += row.get("amount_usd") or 0
		if not by_type[key]["currency"]:
			by_type[key]["currency"] = row.get("currency")
	return list(by_type.values())


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
