import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Root element #root was not found");
}

const appNode = import.meta.env.DEV
  ? <App />
  : (
      <React.StrictMode>
        <App />
      </React.StrictMode>
    );

ReactDOM.createRoot(rootElement).render(appNode);
