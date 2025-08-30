import frappe

import json
import re

no_cache = 1

SCRIPT_TAG_PATTERN = re.compile(r"\<script[^<]*\</script\>")
CLOSING_SCRIPT_TAG_PATTERN = re.compile(r"</script\>")

def get_context(context):
    # Ensure CSRF token is generated
    try:
        csrf_token = frappe.sessions.get_csrf_token()
        frappe.db.commit()
        context.csrf_token = csrf_token
        frappe.logger().info(f"CSRF token generated for user {frappe.session.user}: {csrf_token[:10]}...")
    except Exception as e:
        frappe.logger().error(f"Failed to generate CSRF token: {str(e)}")
        context.csrf_token = ""

    if frappe.session.user == "Guest":
        boot = frappe.website.utils.get_boot_data()
    else:
        try:
            boot = frappe.sessions.get()
        except Exception as e:
            raise frappe.SessionBootFailed from e
    boot_json = frappe.as_json(boot, indent=None, separators=(",", ":"))
    boot_json = SCRIPT_TAG_PATTERN.sub("", boot_json)

    boot_json = CLOSING_SCRIPT_TAG_PATTERN.sub("", boot_json)
    boot_json = json.dumps(boot_json)

    context.update({
        "build_version": frappe.utils.get_build_version(),
        "boot": boot_json,
    })

    return context
