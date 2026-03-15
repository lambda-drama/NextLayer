import frappe
from frappe import _
from frappe.utils import flt, nowdate
from frappe.query_builder import DocType
from typing import Dict, List, Tuple

from nextlayer.next_layer.api.currency_converter import convert as convert_currency


def _get_company_currency(company: str) -> str:
	"""Return company default currency or USD."""
	if not company:
		return "USD"
	return frappe.get_cached_value("Company", company, "default_currency") or "USD"


def _convert(amount: float, from_currency: str, to_currency: str, on_date: str) -> float:
	"""Convert amount between currencies using the shared currency_converter API."""
	amount = flt(amount or 0)
	if not amount or not from_currency or not to_currency or from_currency == to_currency:
		return amount

	try:
		# currency_converter.convert(amount, target_currency, source_currency, date)
		return flt(convert_currency(amount, to_currency, from_currency, on_date), 2)
	except Exception:
		# On any rate error, fall back to original amount
		return amount


def _get_purchase_invoice_items(
	project: str,
	company: str,
	from_date: str | None,
	to_date: str | None,
) -> List[Dict]:
	"""Fetch Purchase Invoice items for a project with optional date range."""
	PurchaseInvoice = DocType("Purchase Invoice")
	PurchaseInvoiceItem = DocType("Purchase Invoice Item")
	Item = DocType("Item")

	query = (
		frappe.qb.from_(PurchaseInvoiceItem)
		.inner_join(PurchaseInvoice)
		.on(PurchaseInvoiceItem.parent == PurchaseInvoice.name)
		.left_join(Item)
		.on(PurchaseInvoiceItem.item_code == Item.item_code)
		.select(
			PurchaseInvoiceItem.item_code,
			Item.item_group,
			PurchaseInvoiceItem.uom,
			PurchaseInvoiceItem.qty,
			PurchaseInvoiceItem.rate,
			PurchaseInvoiceItem.amount,
			PurchaseInvoice.currency,
			PurchaseInvoice.update_stock,
			PurchaseInvoice.posting_date,
		)
		.where(
			(PurchaseInvoice.project == project)
			& (PurchaseInvoice.docstatus == 1)
		)
	)

	if company:
		query = query.where(PurchaseInvoice.company == company)

	if from_date and to_date:
		query = query.where(PurchaseInvoice.posting_date.between(from_date, to_date))
	elif from_date:
		query = query.where(PurchaseInvoice.posting_date >= from_date)
	elif to_date:
		query = query.where(PurchaseInvoice.posting_date <= to_date)

	return query.run(as_dict=True)


def _get_stock_entry_details(
	project: str,
	company: str,
	from_date: str | None,
	to_date: str | None,
) -> List[Dict]:
	"""Fetch Stock Entry details for a project with optional date range."""
	StockEntry = DocType("Stock Entry")
	StockEntryDetail = DocType("Stock Entry Detail")
	Item = DocType("Item")

	query = (
		frappe.qb.from_(StockEntryDetail)
		.inner_join(StockEntry)
		.on(StockEntryDetail.parent == StockEntry.name)
		.left_join(Item)
		.on(StockEntryDetail.item_code == Item.item_code)
		.select(
			StockEntryDetail.item_code,
			Item.item_group,
			StockEntryDetail.uom,
			StockEntryDetail.qty,
			StockEntryDetail.basic_rate.as_("rate"),
			StockEntryDetail.amount,
			StockEntry.posting_date,
		)
		.where(
			(StockEntry.project == project)
			& (StockEntry.docstatus == 1)
			& (
				StockEntry.stock_entry_type.isin(
					["Material Transfer", "Manufacture", "Material Issue"]
				)
			)
		)
	)

	if company:
		query = query.where(StockEntry.company == company)

	if from_date and to_date:
		query = query.where(StockEntry.posting_date.between(from_date, to_date))
	elif from_date:
		query = query.where(StockEntry.posting_date >= from_date)
	elif to_date:
		query = query.where(StockEntry.posting_date <= to_date)

	raw_details = query.run(as_dict=True)

	# Aggregate per (item_group, item_code) with weighted average rate
	aggregated: Dict[Tuple[str, str], Dict] = {}
	for row in raw_details:
		item_code = row.get("item_code")
		item_group = row.get("item_group")
		if not item_code:
			continue
		key = (item_group, item_code)
		if key not in aggregated:
			aggregated[key] = {
				"item_code": item_code,
				"item_group": item_group,
				"uom": row.get("uom"),
				"qty": 0,
				"amount": 0,
			}
		aggregated[key]["qty"] += flt(row.get("qty"))
		aggregated[key]["amount"] += flt(row.get("amount"))

	result: List[Dict] = []
	for (item_group, item_code), data in aggregated.items():
		qty = data["qty"]
		amount = data["amount"]
		rate = amount / qty if qty else 0
		result.append(
			{
				"item_code": item_code,
				"item_group": item_group,
				"uom": data["uom"],
				"qty": qty,
				"rate": rate,
				"amount": amount,
			}
		)

	return result


def _aggregate_purchase_items(purchase_items: List[Dict], company_currency: str) -> Dict[Tuple[str, str], Dict]:
	"""Aggregate purchased quantities and amounts per (item_group, item_code) in company currency."""
	aggregated: Dict[Tuple[str, str], Dict] = {}

	for row in purchase_items:
		item_code = row.get("item_code")
		item_group = row.get("item_group")
		if not item_code:
			continue
		key = (item_group, item_code)

		transaction_currency = row.get("currency") or company_currency
		transaction_date = row.get("posting_date") or nowdate()

		qty = flt(row.get("qty"))
		amount = flt(row.get("amount"))
		rate = flt(row.get("rate"))

		# Normalize to company currency
		if transaction_currency != company_currency:
			amount = _convert(amount, transaction_currency, company_currency, transaction_date)
			rate = _convert(rate, transaction_currency, company_currency, transaction_date)

		if key not in aggregated:
			aggregated[key] = {
				"item_group": item_group,
				"item_code": item_code,
				"purchased_qty": 0.0,
				"purchased_amount": 0.0,
				"rate": rate,
				"uom": row.get("uom"),
				"update_stock_consumed": 0.0,
				"update_stock_amount": 0.0,
			}

		aggregated[key]["purchased_qty"] += qty
		aggregated[key]["purchased_amount"] += amount

		# If invoice did not update stock, treat it as consumed (mirrors Project Summary logic)
		if not row.get("update_stock"):
			aggregated[key]["update_stock_consumed"] += qty
			aggregated[key]["update_stock_amount"] += amount

	return aggregated


def _aggregate_stock_entries(stock_details: List[Dict]) -> Dict[Tuple[str, str], Dict]:
	"""Aggregate consumed quantities and amounts from Stock Entries per (item_group, item_code)."""
	aggregated: Dict[Tuple[str, str], Dict] = {}

	for row in stock_details:
		item_code = row.get("item_code")
		item_group = row.get("item_group")
		if not item_code:
			continue
		key = (item_group, item_code)

		if key not in aggregated:
			aggregated[key] = {
				"item_group": item_group,
				"item_code": item_code,
				"consumed_qty": 0.0,
				"consumed_amount": 0.0,
				"stock_rate": flt(row.get("rate")),
				"uom": row.get("uom"),
			}

		aggregated[key]["consumed_qty"] += flt(row.get("qty"))
		aggregated[key]["consumed_amount"] += flt(row.get("amount"))

	return aggregated


def _get_expense_accounts_for_company(company: str) -> List[str]:
	"""Return list of account names with root_type Expense for the company."""
	if not company:
		return []
	accounts = frappe.get_all(
		"Account",
		filters={"company": company, "root_type": "Expense"},
		pluck="name",
	)
	return list(accounts or [])


@frappe.whitelist()
def get_cost_estimate_vs_consumed(filters=None) -> Dict:
	"""
	Compare Cost Estimate (materials) against actual project consumption.

	- If only consumption data: show consumed amounts with estimate = 0.
	- If only cost estimate: show estimate with consumed = 0.
	- If both: show comparison as now. Labour/overhead split only when cost estimate exists;
	  when no estimate, show combined expense-by-account (actual only).

	Filters:
	    - company (required)
	    - project (optional; required to show consumption when no cost estimate)
	    - project_type (optional)
	    - from_date (optional)
	    - to_date (optional)
	    - currency: display currency; if empty or "all", company currency is used
	"""
	try:
		# Allow both direct JSON argument and standard form_dict (like other APIs)
		if filters is None:
			filters = frappe.form_dict

		if isinstance(filters, str):
			filters = frappe.parse_json(filters)

		filters = filters or {}

		company = filters.get("company")
		project = filters.get("project")
		project_type = filters.get("project_type")
		from_date = filters.get("from_date")
		to_date = filters.get("to_date")
		display_currency = filters.get("currency") or ""

		if not company:
			frappe.throw(_("Company is required"))

		company_currency = _get_company_currency(company)
		if not display_currency or display_currency == "all":
			display_currency = company_currency

		# ------------------------------------------------------------------ #
		# Load the latest Cost Estimate for this project/company (and type)
		# ------------------------------------------------------------------ #
		estimate_filters: Dict[str, object] = {"company": company}
		if project_type:
			estimate_filters["project_type"] = project_type
		if project:
			estimate_filters["project"] = project

		estimate_row = frappe.db.get_value(
			"Cost Estimate",
			estimate_filters,
			["name", "project"],
			as_dict=True,
			order_by="modified desc",
		)

		has_estimate = bool(estimate_row)
		if has_estimate and not project:
			project = estimate_row.get("project")

		# When no cost estimate, we need project from filter to fetch consumption
		if not has_estimate and not project:
			return {
				"success": True,
				"entries": [],
				"totals": {
					"estimate_amount": 0.0,
					"consumed_amount": 0.0,
					"variance_amount": 0.0,
					"estimate_qty": 0.0,
					"consumed_qty": 0.0,
					"variance_qty": 0.0,
				},
				"meta": {
					"company": company,
					"project": "",
					"display_currency": display_currency,
					"company_currency": company_currency,
					"has_cost_estimate": False,
					"estimate_name": None,
					"estimate_grand_total": 0.0,
					"estimate_selling_price_after_profit": 0.0,
					"estimate_labor": 0.0,
					"estimate_overhead": 0.0,
					"consumed_total": 0.0,
					"labor_by_expense_account": {},
					"labor_actual_by_expense_account": {},
					"labor_variance_by_expense_account": {},
					"overhead_by_expense_account": {},
					"overhead_actual_by_expense_account": {},
					"overhead_variance_by_expense_account": {},
					"combined_expense_actual_by_account": {},
					"group_items": {},
					"message": _("Select a project to see consumption without a Cost Estimate, or ensure a Cost Estimate exists for the filters."),
				},
			}

		estimate_map: Dict[str, Dict] = {}
		labor_by_account_ccy: Dict[str, float] = {}
		overhead_by_account_ccy: Dict[str, float] = {}
		estimate_labor_ccy = 0.0
		estimate_overhead_ccy = 0.0
		estimate_name = None
		estimate_by = "Item Group"
		estimate_doc = None
		estimate_currency = company_currency

		if has_estimate:
			estimate_name = estimate_row.get("name")
			estimate_doc = frappe.get_doc("Cost Estimate", estimate_name)
			estimate_currency = estimate_doc.currency or company_currency
			estimate_by = (estimate_doc.estimate_by or "Item Group").strip()

			for row in (estimate_doc.items or []):
				item_group = row.get("item_group")
				item_code = row.get("item_code")
				if not item_group and not item_code:
					continue

				if estimate_by == "Item":
					if not item_code:
						continue
					key = item_code
					label = item_code
				else:
					if not item_group:
						continue
					key = item_group
					label = item_group

				if key not in estimate_map:
					estimate_map[key] = {
						"key": key,
						"label": label,
						"estimate_qty": 0.0,
						"estimate_amount_ccy": 0.0,
					}

				qty = flt(row.get("qty"))
				amount = flt(row.get("amount"))
				if estimate_currency != company_currency:
					amount = _convert(amount, estimate_currency, company_currency, estimate_doc.estimate_date or nowdate())

				estimate_map[key]["estimate_qty"] += qty
				estimate_map[key]["estimate_amount_ccy"] += amount

			for row in (estimate_doc.labor or []):
				expense_account = (row.get("expense_account") or "").strip()
				if not expense_account:
					continue
				calc_type = row.get("calculation_type") or "Per Day"
				if calc_type == "Per Day":
					qty = flt(row.get("qty") or 1)
					cost_native = qty * flt(row.get("days")) * flt(row.get("daily_rate"))
				else:
					cost_native = flt(row.get("amount"))
				cost_ccy = _convert(
					cost_native,
					estimate_currency,
					company_currency,
					estimate_doc.estimate_date or nowdate(),
				)
				labor_by_account_ccy[expense_account] = labor_by_account_ccy.get(expense_account, 0.0) + cost_ccy

			estimate_labor_ccy = sum(labor_by_account_ccy.values())

			for row in (estimate_doc.overheads or []):
				expense_account = (row.get("cost_type") or "").strip()
				if not expense_account:
					continue
				cost_native = flt(row.get("amount"))
				cost_ccy = _convert(
					cost_native,
					estimate_currency,
					company_currency,
					estimate_doc.estimate_date or nowdate(),
				)
				overhead_by_account_ccy[expense_account] = overhead_by_account_ccy.get(expense_account, 0.0) + cost_ccy

			estimate_overhead_ccy = _convert(
				flt(estimate_doc.overhead_cost),
				estimate_currency,
				company_currency,
				estimate_doc.estimate_date or nowdate(),
			)

		# ------------------------------------------------------------------ #
		# Compute actual consumption (only when we have a project)
		# ------------------------------------------------------------------ #
		purchase_items = _get_purchase_invoice_items(project, company, from_date, to_date) if project else []
		stock_details = _get_stock_entry_details(project, company, from_date, to_date) if project else []

		purchase_data = _aggregate_purchase_items(purchase_items, company_currency)
		stock_data = _aggregate_stock_entries(stock_details)

		# Build consumption map keyed by item_group or item_code (use same key style as estimate when we have estimate)
		consumption_map: Dict[str, Dict] = {}
		group_items_map: Dict[str, List[Dict]] = {}
		key_type = estimate_by if has_estimate else "Item Group"

		all_keys: List[Tuple[str, str]] = list(purchase_data.keys())
		for k in stock_data.keys():
			if k not in all_keys:
				all_keys.append(k)

		for item_group, item_code in all_keys:
			pd = purchase_data.get((item_group, item_code), {})
			sd = stock_data.get((item_group, item_code), {})

			purchase_qty = flt(pd.get("purchased_qty"))
			purchased_amount = flt(pd.get("purchased_amount"))

			consumed_qty = flt(sd.get("consumed_qty")) + flt(pd.get("update_stock_consumed"))
			consumed_amount = flt(sd.get("consumed_amount")) + flt(pd.get("update_stock_amount"))

			if key_type == "Item":
				key = item_code
				label = item_code
			else:
				key = item_group
				label = item_group

			if not key:
				continue

			if key not in consumption_map:
				consumption_map[key] = {
					"key": key,
					"label": label,
					"purchase_qty": 0.0,
					"purchase_amount_ccy": 0.0,
					"consumed_qty": 0.0,
					"consumed_amount_ccy": 0.0,
				}

			consumption_map[key]["purchase_qty"] += purchase_qty
			consumption_map[key]["purchase_amount_ccy"] += purchased_amount
			consumption_map[key]["consumed_qty"] += consumed_qty
			consumption_map[key]["consumed_amount_ccy"] += consumed_amount

			item_entry = {
				"item_code": item_code,
				"item_group": item_group,
				"purchase_qty": purchase_qty,
				"purchase_amount_ccy": purchased_amount,
				"consumed_qty": consumed_qty,
				"consumed_amount_ccy": consumed_amount,
			}
			if key not in group_items_map:
				group_items_map[key] = []
			group_items_map[key].append(item_entry)

		# ------------------------------------------------------------------ #
		# Combine estimate vs consumed per key and convert to display currency
		# ------------------------------------------------------------------ #
		all_keys_union = set(estimate_map.keys()) | set(consumption_map.keys())
		effective_date = to_date or from_date or nowdate()

		entries: List[Dict] = []
		totals = {
			"estimate_amount": 0.0,
			"consumed_amount": 0.0,
			"variance_amount": 0.0,
			"estimate_qty": 0.0,
			"consumed_qty": 0.0,
			"variance_qty": 0.0,
		}

		for key in sorted(all_keys_union):
			e = estimate_map.get(key, {})
			c = consumption_map.get(key, {})

			estimate_qty = flt(e.get("estimate_qty"))
			estimate_amount_ccy = flt(e.get("estimate_amount_ccy"))

			consumed_qty = flt(c.get("consumed_qty"))
			consumed_amount_ccy = flt(c.get("consumed_amount_ccy"))

			estimate_amount_disp = _convert(estimate_amount_ccy, company_currency, display_currency, effective_date)
			consumed_amount_disp = _convert(consumed_amount_ccy, company_currency, display_currency, effective_date)

			variance_qty = estimate_qty - consumed_qty
			variance_amount = estimate_amount_disp - consumed_amount_disp

			entry = {
				"project": project or "",
				"key_type": "Item" if key_type == "Item" else "Item Group",
				"key": key,
				"label": e.get("label") or c.get("label") or key,
				"estimate_qty": estimate_qty,
				"estimate_amount": flt(estimate_amount_disp, 2),
				"consumed_qty": consumed_qty,
				"consumed_amount": flt(consumed_amount_disp, 2),
				"variance_qty": flt(variance_qty, 2),
				"variance_amount": flt(variance_amount, 2),
				"currency": display_currency,
			}
			entries.append(entry)

			totals["estimate_amount"] += entry["estimate_amount"]
			totals["consumed_amount"] += entry["consumed_amount"]
			totals["variance_amount"] += entry["variance_amount"]
			totals["estimate_qty"] += estimate_qty
			totals["consumed_qty"] += consumed_qty
			totals["variance_qty"] += variance_qty

		for k in totals:
			totals[k] = flt(totals[k], 2)

		# Header-level meta totals in display currency
		estimate_grand_total_ccy = 0.0
		if has_estimate and estimate_doc:
			estimate_grand_total_ccy = (
				flt(estimate_doc.total_material_cost)
				+ estimate_labor_ccy
				+ estimate_overhead_ccy
			)
		estimate_grand_total_disp = _convert(
			estimate_grand_total_ccy,
			company_currency,
			display_currency,
			effective_date,
		)

		consumed_total_ccy = 0.0
		for c in consumption_map.values():
			consumed_total_ccy += flt(c.get("consumed_amount_ccy"))
		consumed_total_disp = _convert(
			consumed_total_ccy, company_currency, display_currency, effective_date
		)

		# ------------------------------------------------------------------ #
		# Actual expense per account from GL
		# When has_estimate: only labour + overhead accounts (split labour/overhead).
		# When no estimate: all expense accounts for project (combined, no split).
		# ------------------------------------------------------------------ #
		actual_by_account_ccy: Dict[str, float] = {}
		combined_expense_actual_by_account: Dict[str, float] = {}

		if has_estimate:
			all_expense_accounts = list(labor_by_account_ccy.keys()) + [
				a for a in overhead_by_account_ccy.keys() if a not in labor_by_account_ccy
			]
		else:
			all_expense_accounts = _get_expense_accounts_for_company(company)

		if all_expense_accounts and project:
			gl_filters = {
				"company": company,
				"account": ["in", all_expense_accounts],
				"docstatus": 1,
			}
			if from_date and to_date:
				gl_filters["posting_date"] = ["between", [from_date, to_date]]
			elif from_date:
				gl_filters["posting_date"] = [">=", from_date]
			elif to_date:
				gl_filters["posting_date"] = ["<=", to_date]
			gl_filters["project"] = project

			gl_rows = frappe.db.get_all(
				"GL Entry",
				filters=gl_filters,
				fields=["account", "debit", "credit"],
			)

			for row in gl_rows:
				account = row.get("account")
				if not account:
					continue
				net = flt(row.get("debit")) - flt(row.get("credit"))
				actual_by_account_ccy[account] = actual_by_account_ccy.get(account, 0.0) + net

		# When no cost estimate: combined expense by account (actual only)
		if not has_estimate:
			for account, amount_ccy in actual_by_account_ccy.items():
				if amount_ccy == 0:
					continue
				combined_expense_actual_by_account[account] = flt(
					_convert(amount_ccy, company_currency, display_currency, effective_date),
					2,
				)

		# When has estimate: labour/overhead split with estimate, actual, variance
		labor_by_expense_account = {
			account: flt(
				_convert(amount, company_currency, display_currency, effective_date),
				2,
			)
			for account, amount in labor_by_account_ccy.items()
		}
		overhead_by_expense_account = {
			account: flt(
				_convert(amount, company_currency, display_currency, effective_date),
				2,
			)
			for account, amount in overhead_by_account_ccy.items()
		}

		labor_actual_by_expense_account = {}
		labor_variance_by_expense_account = {}
		for account, est_disp in labor_by_expense_account.items():
			actual_ccy = actual_by_account_ccy.get(account, 0.0)
			actual_disp = _convert(actual_ccy, company_currency, display_currency, effective_date)
			labor_actual_by_expense_account[account] = flt(actual_disp, 2)
			labor_variance_by_expense_account[account] = flt(est_disp - actual_disp, 2)

		overhead_actual_by_expense_account = {}
		overhead_variance_by_expense_account = {}
		for account, est_disp in overhead_by_expense_account.items():
			actual_ccy = actual_by_account_ccy.get(account, 0.0)
			actual_disp = _convert(actual_ccy, company_currency, display_currency, effective_date)
			overhead_actual_by_expense_account[account] = flt(actual_disp, 2)
			overhead_variance_by_expense_account[account] = flt(est_disp - actual_disp, 2)

		estimate_selling_disp = 0.0
		if has_estimate and estimate_doc:
			estimate_selling_disp = flt(
				_convert(
					estimate_doc.selling_price_after_profit or 0.0,
					estimate_currency,
					display_currency,
					estimate_doc.estimate_date or nowdate(),
				),
				2,
			)

		meta = {
			"company": company,
			"project": project or "",
			"display_currency": display_currency,
			"company_currency": company_currency,
			"has_cost_estimate": has_estimate,
			"estimate_name": estimate_name,
			"estimate_grand_total": flt(estimate_grand_total_disp, 2),
			"estimate_selling_price_after_profit": estimate_selling_disp,
			"estimate_labor": flt(
				_convert(estimate_labor_ccy, company_currency, display_currency, effective_date),
				2,
			),
			"estimate_overhead": flt(
				_convert(
					estimate_overhead_ccy, company_currency, display_currency, effective_date
				),
				2,
			),
			"consumed_total": flt(consumed_total_disp, 2),
			"labor_by_expense_account": labor_by_expense_account,
			"labor_actual_by_expense_account": labor_actual_by_expense_account,
			"labor_variance_by_expense_account": labor_variance_by_expense_account,
			"overhead_by_expense_account": overhead_by_expense_account,
			"overhead_actual_by_expense_account": overhead_actual_by_expense_account,
			"overhead_variance_by_expense_account": overhead_variance_by_expense_account,
			"combined_expense_actual_by_account": combined_expense_actual_by_account,
			"group_items": group_items_map,
		}

		return {
			"success": True,
			"entries": entries,
			"totals": totals,
			"meta": meta,
		}

	except Exception as e:
		frappe.log_error(f"Cost Estimate vs Consumed Error: {str(e)}")
		return {
			"success": False,
			"error": str(e),
			"entries": [],
			"totals": {},
		}

