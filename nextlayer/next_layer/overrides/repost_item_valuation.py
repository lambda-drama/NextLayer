# Copyright (c) Next Layer. Recreate Sales Shipment Cost GL after Repost Item Valuation.
#
# "Start Reposting" does NOT call repost_now() — it enqueues the scheduler job
# repost_entries(), which runs repost(doc) directly. So the patch in sales_shipment.py
# (on repost() and repost_entries()) is what recreates SSC GL when you click Start Reposting.

from __future__ import unicode_literals

import frappe

from erpnext.stock.doctype.repost_item_valuation.repost_item_valuation import (
	RepostItemValuation,
	get_affected_transactions,
)
from erpnext.stock.doctype.repost_item_valuation.repost_item_valuation import (
	_get_directly_dependent_vouchers,
)


class RepostItemValuationOverride(RepostItemValuation):
	def repost_now(self):
		super(RepostItemValuationOverride, self).repost_now()
		# After repost: recreate Sales Shipment Cost GL for affected Sales Invoices
		# (same as Repost Accounting Ledger on_submit)
		
		try:
			directly_dependent = list(_get_directly_dependent_vouchers(self))
			affected = list(get_affected_transactions(self))
			vouchers = _normalize_vouchers(directly_dependent + affected)
			_recreate_sales_shipment_cost_gl_for_vouchers(vouchers)
		except Exception as e:
			frappe.log_error(
				message=f"Recreate Sales Shipment Cost GL after RIV {self.name}: {e}",
				title="Recreate Sales Shipment Cost GL (RIV)",
			)


def _normalize_vouchers(vouchers):
	"""Ensure each item is (voucher_type, voucher_no); skip None entries."""
	out = []
	for v in vouchers or []:
		if isinstance(v, (list, tuple)) and len(v) >= 2 and v[0] and v[1]:
			out.append((v[0], v[1]))
		elif isinstance(v, dict):
			vt, vn = v.get("voucher_type"), v.get("voucher_no")
			if vt and vn:
				out.append((vt, vn))
	return out


def _recreate_sales_shipment_cost_gl_for_vouchers(vouchers):
	from nextlayer.next_layer.controllers.sales_shipment import (
		recreate_sales_shipment_cost_gl_after_repost_item_valuation,
	)
	recreate_sales_shipment_cost_gl_after_repost_item_valuation(vouchers)
