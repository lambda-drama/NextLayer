import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router-dom"
import IntercompanyReconciliation from "./components/intercompany-reconciliation"
import InterCompanyLedgerSummary from "./components/intercompany-ledger-summary"
import ImportExportExpense from "./components/import-export-expense"
import CostEstimateVsConsumed from "./components/cost-estimate-vs-consumed"
import QuotationStagesReport from "./components/quotation-stages-report"
import PMSDashboard from "./components/pms-dashboard"

function App() {
  return (
    <Router basename="/frontend">
      <main className="min-h-screen bg-background">
        <Routes>
          <Route path="/" element={<IntercompanyReconciliation />} />
          <Route path="/reconciliation" element={<IntercompanyReconciliation />} />
          <Route path="/ledger" element={<InterCompanyLedgerSummary />} />
          <Route path="/import-export" element={<ImportExportExpense />} />
          <Route path="/cost-estimate-vs-consumed" element={<CostEstimateVsConsumed />} />
          <Route path="/quotation-stages" element={<QuotationStagesReport />} />
          <Route path="/pms-dashboard" element={<PMSDashboard />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </Router>
  )
}

export default App
