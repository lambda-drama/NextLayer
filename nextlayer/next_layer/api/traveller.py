import frappe

@frappe.whitelist()
def migrate_all_traveler_names():
    records = frappe.db.sql("""
        SELECT name, traveler_name
        FROM `tabTravel Expense`
        WHERE traveler_name IS NOT NULL AND traveler_name != ''
    """, as_dict=True)

    migrated = 0
    skipped = 0
    errors = []

    for record in records:
        try:
            doc = frappe.get_doc("Travel Expense", record["name"])
            member_value = record["traveler_name"]

            already_exists = any(row.member == member_value for row in doc.traveller_name)

            if already_exists:
                skipped += 1
                continue

            doc.append("traveller_name", {"member": member_value})
            doc.flags.ignore_validate = True
            doc.flags.ignore_mandatory = True
            doc.flags.ignore_permissions = True
            doc.save()
            frappe.db.commit()
            migrated += 1

        except Exception as e:
            errors.append(f"{record['name']}: {str(e)}")
            frappe.db.rollback()

    return {
        "status": "ok",
        "migrated": migrated,
        "skipped": skipped,
        "errors": errors
    }