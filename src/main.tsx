
  import { createRoot } from "react-dom/client";
  import App from "./app/App.tsx";
  import "@fontsource-variable/inter";
  import "./styles/index.css";
  // Initialise i18next before the first render so a stored language choice is
  // already active on the very first paint (avoids a flash of English).
  import "./lib/i18n";
  import { missingSupabaseEnv } from "./lib/supabase";

  const root = createRoot(document.getElementById("root")!);

  // A build made without the Supabase variables cannot work — Vite inlines
  // them at build time, so this is a deploy-configuration fault, not a runtime
  // one. Say so on the page. Previously this surfaced as a blank white screen
  // with the real reason only visible in the browser console, which is a
  // miserable thing to debug on a live site.
  if (missingSupabaseEnv.length > 0) {
    const vars = missingSupabaseEnv.join(" and ");
    root.render(
      <div
        style={{
          minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
          padding: 24, fontFamily: "system-ui, sans-serif", background: "#F8F9FA", color: "#0F172A",
        }}
      >
        <div style={{ maxWidth: 560, lineHeight: 1.6 }}>
          <h1 style={{ fontSize: 20, fontWeight: 700, margin: "0 0 12px" }}>
            Configuration missing
          </h1>
          <p style={{ margin: "0 0 12px", color: "#475569" }}>
            This build is missing {vars}. These are read at build time, so the
            deployment has to be rebuilt after the variables are set — changing
            them without a redeploy will not fix it.
          </p>
          <p style={{ margin: 0, color: "#475569" }}>
            Set them in the hosting project&rsquo;s environment variables
            (Vercel &rarr; Settings &rarr; Environment Variables, for the
            Production environment), then redeploy.
          </p>
        </div>
      </div>,
    );
  } else {
    root.render(<App />);
  }
