import frappe
from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

def execute():
    """Add custom fields for intercompany matching functionality"""

    intercompany_fields = [
        dict(
            fieldname="intercompany_match_status",
            fieldtype="Select",
            label="Intercompany Match Status",
            options="Pending\nMatch\nMismatch",
            # default="Pending",
            insert_after="status"
        ),
        dict(
            fieldname="intercompany_matched_with",
            fieldtype="Text",
            label="Intercompany Matched With",
            description="Details of the matched entry (JSON format)",
            insert_after="intercompany_match_status"
        ),
        dict(
            fieldname="intercompany_matched_by",
            fieldtype="Link",
            label="Intercompany Matched By",
            options="User",
            read_only=1,
            insert_after="intercompany_matched_with"
        ),
        dict(
            fieldname="intercompany_matched_on",
            fieldtype="Datetime",
            label="Intercompany Matched On",
            read_only=1,
            insert_after="intercompany_matched_by"
        )
    ]

    # Apply the same fields to all 4 doctypes
    custom_fields = {
        "Payment Entry": intercompany_fields,
        "Journal Entry": intercompany_fields,
        "Purchase Invoice": intercompany_fields,
        "Sales Invoice": intercompany_fields,
    }

    # Create custom fields safely
    create_custom_fields(custom_fields, ignore_validate=True)

    # Clear cache to reflect changes
    frappe.clear_cache()
    frappe.logger().info("✓ Intercompany custom fields added successfully!")
