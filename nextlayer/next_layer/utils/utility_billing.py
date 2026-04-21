import frappe
from frappe.utils import nowdate

def process_monthly_utility_billing():
    """Monthly job: Generate utility invoices for all active meters"""
    
    meters = frappe.get_all("Utility Meter", filters={"status": "Active"})
    
    for meter in meters:
        meter_doc = frappe.get_doc("Utility Meter", meter.name)
        
        if meter_doc.current_reading:
            # Calculate consumption
            consumption = meter_doc.current_reading - meter_doc.last_reading
            
            # Validate no negative consumption
            if consumption < 0:
                frappe.log_error(
                    f"Negative consumption for meter {meter_doc.meter_id}. "
                    f"Last: {meter_doc.last_reading}, Current: {meter_doc.current_reading}",
                    "Utility Billing Error"
                )
                continue
            
            # Calculate amount
            amount = consumption * meter_doc.tariff_rate
            
            # Create invoice (logic here)
            invoice_name = create_utility_invoice(meter_doc, consumption, amount)
            
            # Create reading log (AUDIT TRAIL)
            create_reading_log(
                meter_doc=meter_doc,
                consumption=consumption,
                amount=amount,
                invoice_name=invoice_name
            )
            
            # Update meter with new readings
            meter_doc.last_reading = meter_doc.current_reading
            meter_doc.last_reading_date = meter_doc.current_reading_date
            meter_doc.last_invoice_date = nowdate()
            meter_doc.last_invoice_amount = amount
            meter_doc.save()
            
            frappe.db.commit()


def create_reading_log(meter_doc, consumption, amount, invoice_name=None):
    """
    Create an audit trail entry for meter reading.
    
    Args:
        meter_doc: Meter document object
        consumption: Calculated consumption (float)
        amount: Calculated invoice amount (float)
        invoice_name: Name of created invoice (optional)
    
    Returns:
        str: Name of the created reading log
    """
    
    # Determine period dates
    if meter_doc.last_reading_date:
        period_start = meter_doc.last_reading_date
    else:
        # If no last reading, use installation date or first day of month
        period_start = meter_doc.installation_date or f"{nowdate()[:8]}01"
    
    period_end = meter_doc.current_reading_date or nowdate()
    
    # Create reading log entry
    reading_log = frappe.get_doc({
        "doctype": "Meter Reading Log",
        "meter": meter_doc.name,
        "meter_id": meter_doc.meter_id,
        "meter_type": meter_doc.meter_type,
        "unit": meter_doc.unit,
        "property": meter_doc.property,
        "period_start": period_start,
        "period_end": period_end,
        "previous_reading": meter_doc.last_reading,
        "current_reading": meter_doc.current_reading,
        "consumption": consumption,
        "uom": meter_doc.uom,
        "tariff_rate": meter_doc.tariff_rate,
        "invoice_amount": amount,
        "invoice": invoice_name,
        "is_estimated": meter_doc.estimated_consumption or 0,
        "notes": f"Auto-generated from monthly billing on {nowdate()}"
    })
    
    reading_log.insert(ignore_permissions=True)
    frappe.db.commit()
    
    return reading_log.name


def create_utility_invoice(meter_doc, consumption, amount):
    """
    Create a Sales Invoice for utility consumption.
    
    Args:
        meter_doc: Meter document object
        consumption: Calculated consumption (float)
        amount: Calculated invoice amount (float)
    
    Returns:
        str: Name of created invoice
    """
    
    # Get tenant from unit's current contract
    unit_doc = frappe.get_doc("Unit", meter_doc.unit)
    
    if not unit_doc.current_tenant:
        frappe.log_error(
            f"No current tenant for unit {meter_doc.unit}. Cannot create utility invoice.",
            "Utility Billing Error"
        )
        return None
    
    # Get customer from tenant
    tenant_doc = frappe.get_doc("Tenant", unit_doc.current_tenant)
    customer = tenant_doc.customer
    
    # Create invoice
    invoice = frappe.get_doc({
        "doctype": "Sales Invoice",
        "customer": customer,
        "due_date": get_due_date(),  # Implement based on your logic
        "items": [
            {
                "item_code": get_utility_item_code(meter_doc.meter_type),
                "qty": consumption,
                "rate": meter_doc.tariff_rate,
                "description": f"{meter_doc.meter_type} consumption for {meter_doc.unit} - {meter_doc.current_reading_date}",
                "uom": meter_doc.uom
            }
        ]
    })
    
    invoice.insert(ignore_permissions=True)
    invoice.submit()
    
    return invoice.name


def get_utility_item_code(meter_type):
    """Get ERPNext Item code for utility type"""
    item_map = {
        "Water": "UTIL-WATER",
        "Electricity": "UTIL-ELECTRICITY",
        "Gas": "UTIL-GAS"
    }
    return item_map.get(meter_type, "UTIL-OTHER")


def get_due_date():
    """Calculate due date based on settings"""
    from frappe.utils import add_days, nowdate
    # Default: due in 15 days
    return add_days(nowdate(), 15)

