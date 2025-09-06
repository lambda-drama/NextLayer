# Intercompany Matching Functionality

This document describes the intercompany matching functionality added to the NextLayer app.

## Overview

The intercompany matching feature allows users to:
- Filter GL entries by match status (Match, Mismatch, Pending)
- Manually match entries between companies
- Track matching status directly on the original documents
- Bulk select and match multiple entries

## Features

### 1. Status Filtering
- Default filter shows "Mismatch" entries
- Filter options: All, Match, Mismatch, Pending
- Real-time count of filtered entries

### 2. Manual Matching
- Individual "Match" buttons for mismatched entries with potential matches
- Bulk selection with checkboxes
- Confirmation modal for bulk matching

### 3. Backend Integration
- Custom fields added to Payment Entry, Journal Entry, Purchase Invoice, and Sales Invoice
- API endpoints for updating and retrieving match status
- Persistent storage of matching information

## Custom Fields Added

The following custom fields are added to each doctype:

- `intercompany_match_status`: Select field (Pending/Match/Mismatch)
- `intercompany_matched_with`: Text field for matched entry details
- `intercompany_matched_by`: Link field to User (read-only)
- `intercompany_matched_on`: Datetime field (read-only)

## API Endpoints

### Update Match Status
```
POST /api/method/nextlayer.next_layer.api.general_ledger.update_match_status
```

Parameters:
- `voucher_type`: Document type (Payment Entry, Journal Entry, etc.)
- `voucher_no`: Document number
- `company`: Company name
- `status`: Match status (Match/Mismatch/Pending)
- `matched_with`: JSON string with matched entry details

### Get Match Status
```
GET /api/method/nextlayer.next_layer.api.general_ledger.get_match_status
```

Parameters:
- `voucher_type`: Document type
- `voucher_no`: Document number
- `company`: Company name

## User Permissions & Company Access Control

The intercompany reconciliation feature respects ERPNext's User Permissions system for company access control:

### How It Works
- Users can only see and access companies they have permission for
- The frontend automatically filters the company dropdown based on user permissions
- All API endpoints validate company access before returning data
- Users without company permissions will see appropriate error messages

### Setting Up Company Permissions
1. Go to **User Permissions** in ERPNext (`Home > Users and Permissions > User Permissions`)
2. Create a new User Permission:
   - Select the user you want to restrict
   - In the **Allow** field, choose "Company"
   - In the **For Value** field, select the specific company
   - Check **Apply to All Document Types**
   - Save the User Permission

### User Experience
- **Admin users**: See all companies (no restrictions)
- **Restricted users**: Only see companies they have permission for
- **Users with no permissions**: See a message to contact administrator
- **Permission errors**: Clear error messages when trying to access unauthorized companies

## Installation

The custom fields are automatically installed when you install or update the NextLayer app. The installation is handled by a Frappe patch that runs during the app migration process.

### Manual Installation (if needed)
If you need to run the patch manually:
```bash
cd /path/to/frappe-bench
bench --site your-site.com migrate
```

### Verify Installation
After installation, you can verify the custom fields are present by:
1. Going to Setup > Customize > Doctype
2. Selecting any of the doctypes (Payment Entry, Journal Entry, Purchase Invoice, Sales Invoice)
3. Checking that the intercompany fields are present in the form

## Usage

### Frontend Interface
1. Navigate to the Intercompany Reconciliation page
2. Select companies and parties
3. Load GL data
4. Use the status filter to view specific entries
5. Select entries using checkboxes
6. Click "Match" buttons for individual entries or "Match Selected" for bulk operations

### Backend Integration
The matching status is stored directly on the original documents, making it easy to:
- Query documents by match status
- Include matching information in reports
- Maintain data integrity

## Technical Details

### Data Flow
1. User selects entries for matching
2. Frontend calls API to update match status
3. Backend updates custom fields on original documents
4. Changes are reflected in the UI immediately

### Error Handling
- API endpoints include comprehensive error handling
- Frontend shows user-friendly error messages
- Failed operations can be retried

### Performance
- Custom fields are indexed for efficient querying
- API responses are cached where appropriate
- Bulk operations are optimized for performance

## Future Enhancements

Potential improvements:
- Automated matching suggestions
- Matching history and audit trail
- Export functionality for matched entries
- Integration with other reconciliation tools
