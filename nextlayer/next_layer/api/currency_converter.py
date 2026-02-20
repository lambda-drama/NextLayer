import frappe
from frappe.utils import add_days, flt, get_datetime_str, nowdate
from frappe import _

__exchange_rates = {}

def convert(value, from_, to, date):
	"""
	convert `value` from `from_` to `to` on `date`
	:param value: Amount to be converted
	:param from_: Currency of `value`
	:param to: Currency to convert to
	:param date: exchange rate as at this date
	:return: Result of converting `value`
	"""
	rate = get_rate_as_at(date, from_, to)
	converted_value = flt(value) / (rate or 1)
	return converted_value


def get_rate_as_at(date, from_currency, to_currency):

    cache_key = f"{from_currency}-{to_currency}@{date}"
    rate = __exchange_rates.get(cache_key)

    if rate:
        return rate

    # 1️⃣ Try direct rate
    rate = get_exchange_rate(from_currency, to_currency, date)

    # 2️⃣ If not found → try reverse pair
    if not rate:
        reverse_rate = get_exchange_rate(to_currency, from_currency, date)

        if reverse_rate:
            rate = 1 / flt(reverse_rate)

    # 3️⃣ Final safeguard
    if not rate:
        frappe.throw(
            _("Exchange rate not found for {0} ↔ {1} on {2}")
            .format(from_currency, to_currency, date)
        )

    __exchange_rates[cache_key] = rate
    return rate

@frappe.whitelist()
def get_exchange_rate(from_currency, to_currency, transaction_date=None, args=None):
	if not (from_currency and to_currency):
		# manqala 19/09/2016: Should this be an empty return or should it throw and exception?
		return
	if from_currency == to_currency:
		return 1

	if not transaction_date:
		transaction_date = nowdate()

	currency_settings = frappe.get_cached_doc("Accounts Settings")
	allow_stale_rates = currency_settings.get("allow_stale")

	filters = [
		["date", "<=", get_datetime_str(transaction_date)],
		["from_currency", "=", from_currency],
		["to_currency", "=", to_currency],
	]

	if args == "for_buying":
		filters.append(["for_buying", "=", "1"])
	elif args == "for_selling":
		filters.append(["for_selling", "=", "1"])

	if not allow_stale_rates:
		stale_days = currency_settings.get("stale_days")
		checkpoint_date = add_days(transaction_date, -stale_days)
		filters.append(["date", ">", get_datetime_str(checkpoint_date)])

	# cksgb 19/09/2016: get last entry in Currency Exchange with from_currency and to_currency.
	entries = frappe.get_all(
		"Currency Exchange", fields=["exchange_rate"], filters=filters, order_by="date desc", limit=1
	)
	if entries:
		return flt(entries[0].exchange_rate)

	if frappe.get_cached_value("Currency Exchange Settings", "Currency Exchange Settings", "disabled"):
		return 0.00

	pegged_currencies = {}

	if currency_settings.allow_pegged_currencies_exchange_rates:
		pegged_currencies = get_pegged_currencies()
		if rate := get_pegged_rate(pegged_currencies, from_currency, to_currency, transaction_date):
			return rate

	try:
		cache = frappe.cache()
		key = f"currency_exchange_rate_{transaction_date}:{from_currency}:{to_currency}"
		value = cache.get(key)

		if not value:
			import requests

			settings = frappe.get_cached_doc("Currency Exchange Settings")
			req_params = {
				"transaction_date": transaction_date,
				"from_currency": from_currency
				if from_currency not in pegged_currencies
				else pegged_currencies[from_currency]["pegged_against"],
				"to_currency": to_currency
				if to_currency not in pegged_currencies
				else pegged_currencies[to_currency]["pegged_against"],
			}
			params = {}
			for row in settings.req_params:
				params[row.key] = format_ces_api(row.value, req_params)
			response = requests.get(format_ces_api(settings.api_endpoint, req_params), params=params)
			# expire in 6 hours
			response.raise_for_status()
			value = response.json()
			for res_key in settings.result_key:
				value = value[format_ces_api(str(res_key.key), req_params)]
			cache.setex(name=key, time=21600, value=flt(value))

		# Support multiple pegged currencies
		value = flt(value)

		if currency_settings.allow_pegged_currencies_exchange_rates and to_currency in pegged_currencies:
			value *= flt(pegged_currencies[to_currency]["ratio"])
		if currency_settings.allow_pegged_currencies_exchange_rates and from_currency in pegged_currencies:
			value /= flt(pegged_currencies[from_currency]["ratio"])

		return flt(value)
	except Exception:
		frappe.log_error("Unable to fetch exchange rate")
		frappe.msgprint(
			_(
				"Unable to find exchange rate for {0} to {1} for key date {2}. Please create a Currency Exchange record manually"
			).format(from_currency, to_currency, transaction_date)
		)
		return 0.0

def format_ces_api(data, param):
	return data.format(
		transaction_date=param.get("transaction_date"),
		to_currency=param.get("to_currency"),
		from_currency=param.get("from_currency"),
	)


def get_pegged_rate(pegged_map, from_currency, to_currency, transaction_date=None):
	from_entry = pegged_map.get(from_currency)
	to_entry = pegged_map.get(to_currency)

	if from_currency in pegged_map and to_currency in pegged_map:
		# Case 1: Both are present and pegged to same bases
		if from_entry["pegged_against"] == to_entry["pegged_against"]:
			return (1 / from_entry["ratio"]) * to_entry["ratio"]

		# Case 2: Both are present but pegged to different bases
		base_from = from_entry["pegged_against"]
		base_to = to_entry["pegged_against"]
		base_rate = get_exchange_rate(base_from, base_to, transaction_date)

		if not base_rate:
			return None

		return (1 / from_entry["ratio"]) * base_rate * to_entry["ratio"]

	# Case 3: from_currency is pegged to to_currency
	if from_entry and from_entry["pegged_against"] == to_currency:
		return flt(from_entry["ratio"])

	# Case 4: to_currency is pegged to from_currency
	if to_entry and to_entry["pegged_against"] == from_currency:
		return 1 / flt(to_entry["ratio"])

	""" If only one entry exists but doesn’t match pegged currency logic, return None """
	return None


def get_pegged_currencies():
	pegged_currencies = frappe.get_all(
		"Pegged Currency Details",
		filters={"parent": "Pegged Currencies"},
		fields=["source_currency", "pegged_against", "pegged_exchange_rate"],
	)

	pegged_map = {
		currency.source_currency: {
			"pegged_against": currency.pegged_against,
			"ratio": flt(currency.pegged_exchange_rate),
		}
		for currency in pegged_currencies
	}
	return pegged_map