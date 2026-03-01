# Copyright (c) 2026, Next Layer and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document
from frappe.utils import flt


class CostEstimate(Document):
	def validate(self):
		self.calculate_totals()

	def calculate_totals(self):
		"""Calculate total material, labor, overhead, grand total and selling price after profit."""
		total_material = sum(flt(row.get("amount")) for row in (self.items or []))
		self.total_material_cost = total_material

		total_labor = 0
		for row in (self.labor or []):
			if row.get("calculation_type") == "Per Day":
				total_labor += flt(row.get("days"), 0) * flt(row.get("daily_rate"), 0)
			else:
				total_labor += flt(row.get("amount"), 0)
		self.total_labor_cost = total_labor

		total_overhead = sum(flt(row.get("amount")) for row in (self.overheads or []))
		self.overhead_cost = total_overhead

		cost_total = total_material + total_labor + total_overhead
		self.grand_total = cost_total

		profit_pct = flt(self.profit_percent, 0) or 0
		self.selling_price_after_profit = cost_total * (1 + profit_pct / 100)


@frappe.whitelist()
def get_template_data(template_name, currency=None):
	"""
	Return template items, labor, overheads (and header defaults) so the form can
	populate without saving. Call this when user selects a template.
	"""
	if not template_name:
		return {}
	template = frappe.get_doc("Cost Estimate Template", template_name)
	currency = currency or template.currency

	items = []
	for row in template.items:
		rate = flt(row.get("rate"))
		if not rate and row.get("item_code") and currency:
			rate = flt(get_item_price(row.get("item_code"), currency), 0)
		qty = flt(row.get("qty"), 1)
		items.append({
			"item_code": row.get("item_code"),
			"description": row.get("description"),
			"qty": qty,
			"uom": row.get("uom"),
			"rate": rate,
			"amount": qty * rate,
		})

	labor = []
	for row in template.labor:
		calc_type = row.get("calculation_type") or "Per Day"
		if calc_type == "Per Day":
			cost = flt(row.get("days"), 0) * flt(row.get("daily_rate"), 0)
		else:
			cost = flt(row.get("amount"), 0)
		labor.append({
			"calculation_type": calc_type,
			"activity": row.get("activity"),
			"resource_type": row.get("resource_type"),
			"days": row.get("days"),
			"daily_rate": row.get("daily_rate"),
			"contractor_description": row.get("contractor_description"),
			"amount": row.get("amount"),
			"cost": cost,
		})

	overheads = []
	for row in template.overheads:
		overheads.append({
			"cost_type": row.get("cost_type"),
			"amount": flt(row.get("amount")),
			"notes": row.get("notes"),
		})

	return {
		"project_type": template.project_type,
		"currency": template.currency,
		"items": items,
		"labor": labor,
		"overheads": overheads,
	}


@frappe.whitelist()
def get_items_from_template(docname):
	"""Populate Cost Estimate items, labor and overheads from the selected Cost Estimate Template (saves doc)."""
	if not docname:
		frappe.throw("Save the document first before getting items from template.")
	doc = frappe.get_doc("Cost Estimate", docname)
	if not doc.cost_estimate_template:
		frappe.throw("Please select a Cost Estimate Template first.")
	data = get_template_data(doc.cost_estimate_template, doc.currency)
	if not data:
		return True

	if not doc.currency and data.get("currency"):
		doc.currency = data["currency"]
	if not doc.project_type and data.get("project_type"):
		doc.project_type = data["project_type"]

	doc.items = []
	for row in data.get("items") or []:
		doc.append("items", row)

	doc.labor = []
	for row in data.get("labor") or []:
		doc.append("labor", row)

	doc.overheads = []
	for row in data.get("overheads") or []:
		doc.append("overheads", row)

	doc.calculate_totals()
	doc.save()
	return True


@frappe.whitelist()
def get_item_price(item_code, currency):
	"""Get latest Item Price for the item and currency. Returns 0 if not found."""
	if not item_code:
		return 0
	try:
		filters = {"item_code": item_code}
		if currency:
			filters["currency"] = currency
		rows = frappe.get_all(
			"Item Price",
			filters=filters,
			fields=["price_list_rate"],
			order_by="valid_from desc",
			limit=1,
		)
		return flt(rows[0].price_list_rate, 0) if rows else 0
	except Exception:
		return 0
