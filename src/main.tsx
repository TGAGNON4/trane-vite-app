import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

// Amplify is optional for this app; keep the config lines for later.
//import { Amplify } from "aws-amplify";
//import outputs from "../amplify_outputs.json";
//Amplify.configure(outputs);

// App entry point.
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
