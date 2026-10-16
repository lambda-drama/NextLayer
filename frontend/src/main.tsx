import React from "react"
import ReactDOM from "react-dom/client"
import App from "./App.tsx"
import "./index.css"

// Apply the saved colour scheme before the first paint so every route
// (ledger, reconciliation, import/export, …) honours the chosen theme.
const THEME_STORAGE_KEY = "nextlayer-ui-theme"
const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY)
const prefersDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches
document.documentElement.classList.toggle(
  "dark",
  storedTheme === "dark" || (storedTheme === null && Boolean(prefersDark)),
)

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
