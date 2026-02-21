import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router-dom"
import IntercompanyReconciliation from "./components/intercompany-reconciliation"
import InterCompanyLedgerSummary from "./components/intercompany-ledger-summary"
import ImportExportExpense from "./components/import-export-expense"

function App() {
  return (
    <Router basename="/frontend">
      <main className="min-h-screen bg-background">
        <Routes>
          <Route path="/" element={<IntercompanyReconciliation />} />
          <Route path="/reconciliation" element={<IntercompanyReconciliation />} />
          <Route path="/ledger" element={<InterCompanyLedgerSummary />} />
          <Route path="/import-export" element={<ImportExportExpense />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </Router>
  )
}

export default App
