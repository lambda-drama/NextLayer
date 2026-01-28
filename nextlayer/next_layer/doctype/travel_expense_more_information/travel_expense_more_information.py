import frappe
from frappe.model.document import Document


class TravelExpenseMoreInformation(Document):
    """Child table for additional/refund lines on Travel Expense.

    Logic is handled in travel_expense_utils; this class is a simple stub so
    Frappe can import the DocType module during migrate.
    """

    pass

