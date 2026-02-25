app_name = "nextlayer"
app_title = "Next Layer"
app_publisher = "jr@gmail.com"
app_description = "More improvements on ERPNext"
app_email = "jr@gmail.com"
app_license = "mit"

# Apps
# ------------------

# required_apps = []

# Each item in the list will be shown as an app in the apps page
add_to_apps_screen = [
	{
		"name": "nextlayer",
		"logo": "/assets/nextlayer/images/logo.jpeg",
		"title": "Next Layer",
		"route": "/nextlayer",
		# "has_permission": "nextlayer.api.permission.has_app_permission"
	}
]

fixtures = [
    {
        "doctype": "Custom Field",
        "filters": [
            [
                "name",
                "in",
                (
                    "Global Defaults-custom_admin_password",
                    "Item Barcode-custom_image",
                    "Purchase Invoice-custom_scanning_operation",
                    "Purchase Receipt-custom_scanning_operation",
                    "Sales Invoice-custom_scanning_operation",
                    "Delivery Note-custom_scanning_operation",
                    "Item-custom_parent_item",
                    "Item-custom_is_parent",
                    "Expense Claim Detail-custom_flight_no",
                    "Expense Claim-custom_flight_no",
                    "Expense Claim-custom_column_break_luxng",
                    "Expense Claim-custom_book_journal",
                    "Expense Claim-custom_currency",
                    "Expense Claim-custom_travel_details",
                    "Expense Claim-custom_column_break_1111111",
                    ""
                    # "Expense Claim-custom_column_1",
                    "Expense Claim-custom_departure_airport",
                    "Expense Claim-custom_arrival_airport",
                    "Expense Claim-custom_airlines",
                    "Expense Claim-custom_amount",
                    "Expense Claim-custom_column_break_smd2y",
                    # "Expense Claim-custom_column_break_ffvc7",
                    "Expense Claim-custom_date_of_travel",
                    "Expense Claim-custom_date_of_arrival",
                    "Expense Claim-custom_date_of_purchase",
                   
                    # "Expense Claim-custom_pnr_number_",
                    "Expense Claim-custom_amountcompany_currency",
                    "Expense Claim-custom_column_break_ajbxm",
                    "Expense Claim-custom_booked_by",
                    "Expense Claim-custom_travel_type",
                    "Expense Claim-custom_pnr_number_",

                    # "Expense Claim-custom_amount",
                    "Sales Invoice-custom_engine",
                    "Sales Invoice-custom_chassis_no",
                    "Sales Invoice-custom_column_break_o0b9s",
                    "Sales Invoice-custom_model",
                    "Sales Invoice-custom_color",
                    "Sales Invoice-custom_owner_information",
                    
                    "Sales Invoice-custom_assembled_by",
                    "Sales Invoice-custom_registered_owner",
                    "Customer Group-custom_unique_gl_series",
                    "Journal Entry Account-custom_travel_expense_ref",
                    "Journal Entry-custom_intercompany_match_details",
                    
                    #Sales Order
                    "Sales Order-custom_engine",
                    "Sales Order-custom_chassis_no",
                    "Sales Order-custom_column_break_l7nyf",
                    "Sales Order-custom_model",
                    "Sales Order-custom_color",
                    "Sales Order-custom_registered_owner",
                    "Sales Order-custom_assembled_by",
                    "Sales Order-custom_owner_information",
                ),
            ]
        ],
    },
    {
        "doctype": "Custom HTML Block",
        "filters": [
            ["name", "in", ["Main Dashboard Table", "Company Filter"]]
        ]
    },
    {
        "doctype": "Server Script",
        "filters": [
            ["module", "=", "NextLayer"]
        ]
    },
    {
        "doctype": "Server Script",
        "filters": [
            
        ]
    },
     {
        "doctype": "Receipt Entry Remark",
        "filters": [
            
        ]
    },
     {
        "dt": "Client Script",
        "filters": [
            [
                "name",
                "in",
                [
                    "Sales Shipment Cost Repost"
                ]
            ]
        ]
    },{
        "doctype":"Travel Group",
        "filters":[
        ]
    }
]



doc_events = {
    "Repost Accounting Ledger": {
        "on_submit": "nextlayer.next_layer.controllers.sales_shipment.recreate_sales_shipment_cost_gl_after_repost_submit",
    },
    "Sales Order": {
        "before_save": "nextlayer.next_layer.controllers.sales_order.before_save",
    },
    "Sales Shipment Cost": {
        "on_update":"nextlayer.next_layer.controllers.sales_shipment.update_landed_cost_rows",
        "on_submit": "nextlayer.next_layer.controllers.sales_shipment.on_submit",
        "on_cancel": "nextlayer.next_layer.controllers.sales_shipment.on_cancel",
    },
    "Sales Invoice": {
        # "validate": "nextlayer.next_layer.controllers.sales_invoice.auto_pull_advances",
        "before_submit": "nextlayer.next_layer.api.general_ledger.clear_intercompany_fields_before_submit",
        "on_cancel": "nextlayer.next_layer.api.general_ledger.cleanup_intercompany_matches_on_cancel",
    },
    "Purchase Invoice": {
        "before_submit": "nextlayer.next_layer.api.general_ledger.clear_intercompany_fields_before_submit",
        "on_cancel": "nextlayer.next_layer.api.general_ledger.cleanup_intercompany_matches_on_cancel",
    },
    "Journal Entry": {
        "before_save": "nextlayer.next_layer.api.general_ledger.clear_intercompany_fields_before_submit",
        "before_submit": "nextlayer.next_layer.api.general_ledger.clear_intercompany_fields_before_submit",
        "on_cancel": "nextlayer.next_layer.api.general_ledger.cleanup_intercompany_matches_on_cancel",
    },
    "Payment Entry": {
        "before_submit": "nextlayer.next_layer.api.general_ledger.clear_intercompany_fields_before_submit",
        "on_cancel": "nextlayer.next_layer.api.general_ledger.cleanup_intercompany_matches_on_cancel",
    },
    "Expense Claim": {
        "before_save": "nextlayer.next_layer.api.expense_claim_utils.update_child_table_details",
        "before_submit": "nextlayer.next_layer.api.expense_claim_utils.set_expense_approver_and_status",
        "on_submit": "nextlayer.next_layer.api.expense_claim_utils.create_journal_entry_on_submit",
    },
    "Item": {
        "before_save": "nextlayer.next_layer.controllers.generate_barcode.auto_generate_barcode_for_item",
    },
}

# Includes in <head>
# ------------------

# include js, css files in header of desk.html
# app_include_css = "/assets/nextlayer/css/nextlayer.css"
# app_include_js = "/assets/nextlayer/js/nextlayer.js"

# include js, css files in header of web template
# web_include_css = "/assets/nextlayer/css/nextlayer.css"
# web_include_js = "/assets/nextlayer/js/nextlayer.js"

# include custom scss in every website theme (without file extension ".scss")
# website_theme_scss = "nextlayer/public/scss/website"

# include js, css files in header of web form
# webform_include_js = {"doctype": "public/js/doctype.js"}
# webform_include_css = {"doctype": "public/css/doctype.css"}

# include js in page
# page_js = {"page" : "public/js/file.js"}

# include js in doctype views
# doctype_js = {"doctype" : "public/js/doctype.js"}

doctype_js = {
	"Company":"public/js/company.js",
	"Item":"public/js/item.js",
	"Sales Invoice":"public/js/sales_invoice.js",
	"Sales Order":"public/js/sales_order.js",
	"Purchase Invoice":"public/js/purchase_invoice.js",
	"Expense Claim":"public/js/expense_claim_flight_lookup.js",
	"Travel Expense":"public/js/travel_expense_flight_lookup.js",
	"Journal Entry":"public/js/journal_entry.js",
}

# doctype_list_js = {"doctype" : "public/js/doctype_list.js"}
# doctype_tree_js = {"doctype" : "public/js/doctype_tree.js"}
# doctype_calendar_js = {"doctype" : "public/js/doctype_calendar.js"}

# Svg Icons
# ------------------
# include app icons in desk
# app_include_icons = "nextlayer/public/icons.svg"

# Home Pages
# ----------

# application home page (will override Website Settings)
# home_page = "login"

# website user home page (by Role)
# role_home_page = {
# 	"Role": "home_page"
# }



# automatically create page for each record of this doctype
# website_generators = ["Web Page"]

# Jinja
# ----------

# add methods and filters to jinja environment
jinja = {
	"methods": "nextlayer.next_layer.utils.jinja_methods"
}

# Installation
# ------------

# before_install = "nextlayer.install.before_install"
# after_install = "nextlayer.install.after_install"

# Uninstallation
# ------------

# before_uninstall = "nextlayer.uninstall.before_uninstall"
# after_uninstall = "nextlayer.uninstall.after_uninstall"

# Integration Setup
# ------------------
# To set up dependencies/integrations with other apps
# Name of the app being installed is passed as an argument

# before_app_install = "nextlayer.utils.before_app_install"
# after_app_install = "nextlayer.utils.after_app_install"

# Integration Cleanup
# -------------------
# To clean up dependencies/integrations with other apps
# Name of the app being uninstalled is passed as an argument

# before_app_uninstall = "nextlayer.utils.before_app_uninstall"
# after_app_uninstall = "nextlayer.utils.after_app_uninstall"

# Desk Notifications
# ------------------
# See frappe.core.notifications.get_notification_config

# notification_config = "nextlayer.notifications.get_notification_config"

# Permissions
# -----------
# Permissions evaluated in scripted ways

# permission_query_conditions = {
# 	"Event": "frappe.desk.doctype.event.event.get_permission_query_conditions",
# }
#
# has_permission = {
# 	"Event": "frappe.desk.doctype.event.event.has_permission",
# }

# DocType Class
# ---------------
# Override standard doctype classes
override_doctype_class = {
	"Repost Item Valuation": "nextlayer.next_layer.overrides.repost_item_valuation.RepostItemValuationOverride",
}

# Document Events
# ---------------
# Hook on document methods and events

# doc_events = {
# 	"*": {
# 		"on_update": "method",
# 		"on_cancel": "method",
# 		"on_trash": "method"
# 	}
# }

# Scheduled Tasks
# ---------------

# scheduler_events = {
# 	"all": [
# 		"nextlayer.tasks.all"
# 	],
# 	"daily": [
# 		"nextlayer.tasks.daily"
# 	],
# 	"hourly": [
# 		"nextlayer.tasks.hourly"
# 	],
# 	"weekly": [
# 		"nextlayer.tasks.weekly"
# 	],
# 	"monthly": [
# 		"nextlayer.tasks.monthly"
# 	],
# }

# Testing
# -------

# before_tests = "nextlayer.install.before_tests"

# Overriding Methods
# ------------------------------
#
# override_whitelisted_methods = {
# 	"frappe.desk.doctype.event.event.get_events": "nextlayer.event.get_events"
# }
#
# each overriding function accepts a `data` argument;
# generated from the base implementation of the doctype dashboard,
# along with any modifications made in other Frappe apps
# override_doctype_dashboards = {
# 	"Task": "nextlayer.task.get_dashboard_data"
# }

# exempt linked doctypes from being automatically cancelled
#
# auto_cancel_exempted_doctypes = ["Auto Repeat"]

# Ignore links to specified DocTypes when deleting documents
# -----------------------------------------------------------

# ignore_links_on_delete = ["Communication", "ToDo"]

# Request Events
# ----------------
# before_request / after_request not used for RIV; use override_doctype_class + app init patch

# Job Events
# ----------
# before_job = ["nextlayer.utils.before_job"]
# after_job = ["nextlayer.utils.after_job"]

# User Data Protection
# --------------------

# user_data_fields = [
# 	{
# 		"doctype": "{doctype_1}",
# 		"filter_by": "{filter_by}",
# 		"redact_fields": ["{field_1}", "{field_2}"],
# 		"partial": 1,
# 	},
# 	{
# 		"doctype": "{doctype_2}",
# 		"filter_by": "{filter_by}",
# 		"partial": 1,
# 	},
# 	{
# 		"doctype": "{doctype_3}",
# 		"strict": False,
# 	},
# 	{
# 		"doctype": "{doctype_4}"
# 	}
# ]

# Authentication and authorization
# --------------------------------

# auth_hooks = [
# 	"nextlayer.auth.validate"
# ]

# Automatically update python controller files with type annotations for this app.
# export_python_type_annotations = True

# default_log_clearing_doctypes = {
# 	"Logging DocType Name": 30  # days to retain logs
# }

website_route_rules = [
    {'from_route': '/frontend/<path:app_path>', 'to_route': 'frontend'},
    {'from_route': '/frontend', 'to_route': 'frontend'},
    {'from_route': '/reconciliation', 'to_route': 'frontend'},
    {'from_route': '/ledger', 'to_route': 'frontend'}
]
