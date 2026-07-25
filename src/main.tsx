
  import { createRoot } from "react-dom/client";
  import App from "./app/App.tsx";
  import "@fontsource-variable/inter";
  import "./styles/index.css";
  // Initialise i18next before the first render so a stored language choice is
  // already active on the very first paint (avoids a flash of English).
  import "./lib/i18n";

  createRoot(document.getElementById("root")!).render(<App />);
  