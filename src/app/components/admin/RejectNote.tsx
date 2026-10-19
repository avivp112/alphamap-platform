import React from "react";
import { useTranslation } from "react-i18next";

/** The optional "why?" box under a reject button on the admin review screen. */
export function RejectNote(props: {
  note: string; setNote: (s: string) => void; onCancel: () => void; onConfirm: () => void; busy: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex w-full flex-wrap items-center gap-2 pt-1">
      <input
        autoFocus
        value={props.note}
        onChange={(e) => props.setNote(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") props.onConfirm(); if (e.key === "Escape") props.onCancel(); }}
        placeholder={t("adminReview.rejectNotePlaceholder")}
        className="min-w-[200px] flex-1 rounded-md border border-gray-200 px-3 py-1.5 text-sm focus:border-gray-400 focus:outline-none"
      />
      <button disabled={props.busy} onClick={props.onConfirm}
        className="rounded-md bg-rose-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-40">
        {t("adminReview.confirmReject")}
      </button>
      <button onClick={props.onCancel} className="px-2 py-1.5 text-sm text-gray-500 hover:text-gray-700">{t("adminReview.cancel")}</button>
    </div>
  );
}
