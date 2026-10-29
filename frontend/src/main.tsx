import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { ToastProvider } from "./components/Toast";
import { loadCustomization, applyCustomization } from "./pages/AppsPage";
import "./styles/global.css";

// Apply saved theme before render (no flash)
const savedTheme = localStorage.getItem("theme") ?? "light";
document.documentElement.setAttribute("data-theme", savedTheme);

// Apply saved customization
applyCustomization(loadCustomization());

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <ToastProvider>
        <App />
      </ToastProvider>
    </BrowserRouter>
  </React.StrictMode>
);
