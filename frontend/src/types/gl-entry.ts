export interface GLEntry {
  gl_entry?: string
  posting_date: string
  account: string
  voucher_type: string
  voucher_no: string
  debit: number
  credit: number
  balance: number
  against: string
  remarks?: string
  party_type?: string
  party?: string
  cost_center?: string
  project?: string
  status?: 'Match' | 'Mismatch' | 'Pending'
  matchedEntry?: GLEntry
  backendMatchData?: {
    status: string
    matched_with?: string
    matched_with_parsed?: any
    matched_by?: string
    matched_on?: string
  }
  match_status?: string
  matched_with?: string
  is_hidden?: boolean
}
