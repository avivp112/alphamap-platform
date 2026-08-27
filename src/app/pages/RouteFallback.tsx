import React from "react";
import { useNavigate, useRouteError, isRouteErrorResponse } from "react-router";
import { useTranslation } from "react-i18next";
import { BrandMark, BrandWordmark } from "../components/BrandMark";
import { homePathNow } from "../../lib/navHome";

// ─────────────────────────────────────────────────────────────────────────────
// The two ways a user ends up nowhere.
//
// NotFound  — the URL matched no route. Without a catch-all, react-router
//             throws a 404 and renders its own developer-facing error screen,
//             stack trace and all.
// RouteError— something threw while rendering. Same default screen, which
//             leaks internals and offers no way out except the back button.
//
// Neither replaces the server-side fix: a hard refresh on /dashboard never
// reaches React at all unless the host rewrites unknown paths to index.html
// (see vercel.json). These handle the cases that DO reach the app.
// ─────────────────────────────────────────────────────────────────────────────

function Shell({ title, detail }: { title: string; detail: string }) {
  const navigate = useNavigate();
  const { t } = useTranslation();
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[#FAFAF9] px-6 text-center">
      <button
        type="button"
        onClick={async () => navigate(await homePathNow("/"))}
        aria-label={t("nav.goHome")}
        className="flex items-center gap-2.5 mb-10 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/30"
      >
        <BrandMark size={32} />
        <BrandWordmark className="text-xl tracking-tight text-[#0F172A]" />
      </button>

      <h1
        className="text-3xl md:text-4xl font-normal text-[#111827] tracking-tight"
        style={{ fontFamily: "'Playfair Display', serif" }}
      >
        {title}
      </h1>
      <p className="mt-4 max-w-[520px] text-base leading-relaxed text-[#4B5563]">{detail}</p>

      <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          onClick={async () => navigate(await homePathNow("/"))}
          className="rounded-lg bg-[#0F172A] px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#1E293B]"
        >
          {t("errors.goHome")}
        </button>
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="rounded-lg border border-black/10 bg-white px-6 py-2.5 text-sm font-semibold text-[#111827] transition-colors hover:bg-gray-50"
        >
          {t("errors.goBack")}
        </button>
      </div>
    </div>
  );
}

export function NotFound() {
  const { t } = useTranslation();
  return <Shell title={t("errors.notFoundTitle")} detail={t("errors.notFoundBody")} />;
}

export function RouteError() {
  const { t } = useTranslation();
  const error = useRouteError();

  // A thrown Response (react-router's own 404s) is not a crash — treat it as
  // a wrong address rather than telling the user something broke.
  if (isRouteErrorResponse(error) && error.status === 404) return <NotFound />;

  // The message goes to the console, not the page: it is for whoever is
  // debugging, and putting a stack trace in front of a customer helps nobody.
  if (error) console.error("Route error:", error);

  return <Shell title={t("errors.crashTitle")} detail={t("errors.crashBody")} />;
}
