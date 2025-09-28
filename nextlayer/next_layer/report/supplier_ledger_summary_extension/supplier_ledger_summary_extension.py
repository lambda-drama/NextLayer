# Copyright (c) 2025, jr@gmail.com and contributors
# For license information, please see license.txt

# import frappe

from nextlayer.next_layer.report.customer_ledger_summary_extension.customer_ledger_summary_extension import (
    PartyLedgerSummaryReport,
)


def execute(filters=None):
    args = {
        "party_type": "Supplier",
        "naming_by": ["Buying Settings", "supp_master_name"],
    }
    return PartyLedgerSummaryReport(filters).run(args)
