import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import {
  MessageCircle, Handshake, Newspaper, LifeBuoy, Building2,
  Loader2, Send, CheckCircle2, AlertCircle,
} from "lucide-react";
import { Layout } from "../components/Layout";
import { submitContactMessage, type ContactTopic } from "../../lib/supabase";

const TOPICS: { id: ContactTopic; icon: React.ElementType; labelKey: string; reasonKey: string }[] = [
  { id: "general",     icon: MessageCircle, labelKey: "contact.topics.general",     reasonKey: "contact.reasons.general" },
  { id: "partnership", icon: Handshake,     labelKey: "contact.topics.partnership", reasonKey: "contact.reasons.partnership" },
  { id: "press",       icon: Newspaper,     labelKey: "contact.topics.press",       reasonKey: "contact.reasons.press" },
  { id: "support",     icon: LifeBuoy,      labelKey: "contact.topics.support",     reasonKey: "contact.reasons.support" },
  { id: "enterprise",  icon: Building2,     labelKey: "contact.topics.enterprise", reasonKey: "contact.reasons.enterprise" },
];

const MAX_MESSAGE = 2000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface FormValues {
  name: string;
  email: string;
  topic: ContactTopic;
  message: string;
}

interface FieldErrors {
  name?: string;
  email?: string;
  message?: string;
}

function validate(values: FormValues, t: TFunction): FieldErrors {
  const errors: FieldErrors = {};
  if (!values.name.trim()) errors.name = t("auth.validation.nameRequired");
  else if (values.name.trim().length < 2) errors.name = t("auth.validation.nameShort");

  if (!values.email.trim()) errors.email = t("auth.validation.emailRequired");
  else if (!EMAIL_RE.test(values.email.trim())) errors.email = t("auth.validation.emailInvalid");

  if (!values.message.trim()) errors.message = t("contact.form.messageRequired");

  return errors;
}

const inputCls =
  "w-full rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm text-[#0F172A] " +
  "placeholder-gray-400 transition-all focus:outline-none focus:border-[#0F172A]/30 focus:ring-2 focus:ring-[#0F172A]/10";
const inputErrCls = "border-rose-300 focus:border-rose-400 focus:ring-rose-100";
const labelCls = "block text-xs font-semibold text-gray-600 mb-1.5";

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="mt-1.5 text-xs font-medium text-rose-600">{message}</p>;
}

export function ContactUs() {
  const { t } = useTranslation();
  const [values, setValues] = useState<FormValues>({ name: "", email: "", topic: "general", message: "" });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [sending, setSending] = useState(false);
  const [sentOk, setSentOk] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const fieldErrors = validate(values, t);
    setErrors(fieldErrors);
    if (Object.keys(fieldErrors).length > 0) return;

    setSending(true);
    setSubmitError(null);
    try {
      await submitContactMessage(values);
      setSentOk(true);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : t("contact.form.errorGeneric"));
    } finally {
      setSending(false);
    }
  }

  function reset() {
    setValues({ name: "", email: "", topic: "general", message: "" });
    setErrors({});
    setSubmitError(null);
    setSentOk(false);
  }

  return (
    <Layout>
      <div className="mx-auto max-w-[1200px] px-4 sm:px-6 lg:px-8 py-12 sm:py-16">
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.15fr] gap-12 lg:gap-16">
          {/* ── Left: intro + reasons to reach out ── */}
          <div>
            <h1
              className="text-3xl sm:text-4xl font-normal tracking-tight text-[#0F172A] mb-4"
              style={{ fontFamily: "'Playfair Display', serif" }}
            >
              {t("contact.title")}
            </h1>
            <p className="text-sm sm:text-base leading-relaxed text-gray-500 mb-10 max-w-md">
              {t("contact.subtitle")}
            </p>

            <div className="space-y-4">
              {TOPICS.map(({ id, icon: Icon, labelKey, reasonKey }) => (
                <div key={id} className="flex items-start gap-3.5 rounded-2xl border border-gray-100 bg-white p-4 shadow-[0_4px_20px_rgba(0,0,0,0.02)]">
                  <div className="flex-none w-10 h-10 rounded-xl bg-gray-50 border border-gray-100 flex items-center justify-center">
                    <Icon className="w-4.5 h-4.5 text-[#0F172A]" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-[#0F172A]">{t(labelKey)}</p>
                    <p className="text-xs text-gray-500 leading-relaxed mt-0.5">{t(reasonKey)}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* ── Right: the form itself ── */}
          <div className="rounded-[28px] border border-gray-100 bg-white p-7 sm:p-9 shadow-[0_24px_60px_rgba(15,23,42,0.06)]">
            {sentOk ? (
              <div className="flex flex-col items-center justify-center text-center py-10">
                <div className="w-14 h-14 rounded-full bg-[#7C8967]/10 flex items-center justify-center mb-5">
                  <CheckCircle2 className="w-7 h-7 text-[#7C8967]" />
                </div>
                <h2 className="text-xl font-bold text-[#0F172A] mb-2">{t("contact.form.successTitle")}</h2>
                <p className="text-sm text-gray-500 max-w-xs leading-relaxed mb-7">{t("contact.form.successBody")}</p>
                <button
                  type="button"
                  onClick={reset}
                  className="rounded-xl border border-gray-200 px-5 py-2.5 text-sm font-semibold text-[#0F172A] hover:bg-gray-50 transition-colors"
                >
                  {t("contact.form.sendAnother")}
                </button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} noValidate>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
                  <div>
                    <label className={labelCls}>{t("contact.form.name")}</label>
                    <input
                      type="text"
                      value={values.name}
                      onChange={(e) => setValues((v) => ({ ...v, name: e.target.value }))}
                      placeholder={t("contact.form.namePlaceholder")}
                      className={`${inputCls} ${errors.name ? inputErrCls : ""}`}
                    />
                    <FieldError message={errors.name} />
                  </div>
                  <div>
                    <label className={labelCls}>{t("contact.form.email")}</label>
                    <input
                      type="email"
                      value={values.email}
                      onChange={(e) => setValues((v) => ({ ...v, email: e.target.value }))}
                      placeholder={t("contact.form.emailPlaceholder")}
                      className={`${inputCls} ${errors.email ? inputErrCls : ""}`}
                    />
                    <FieldError message={errors.email} />
                  </div>
                </div>

                <div className="mb-4">
                  <label className={labelCls}>{t("contact.form.topic")}</label>
                  <div className="flex flex-wrap gap-2">
                    {TOPICS.map(({ id, icon: Icon, labelKey }) => {
                      const active = values.topic === id;
                      return (
                        <button
                          key={id}
                          type="button"
                          onClick={() => setValues((v) => ({ ...v, topic: id }))}
                          className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors ${
                            active
                              ? "bg-[#0F172A] text-white"
                              : "bg-gray-50 border border-gray-200 text-gray-600 hover:bg-gray-100"
                          }`}
                        >
                          <Icon className="w-3.5 h-3.5" />
                          {t(labelKey)}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="mb-2">
                  <div className="flex items-center justify-between">
                    <label className={labelCls}>{t("contact.form.message")}</label>
                    <span className="text-[11px] text-gray-400 mb-1.5">
                      {values.message.length}/{MAX_MESSAGE}
                    </span>
                  </div>
                  <textarea
                    value={values.message}
                    onChange={(e) => setValues((v) => ({ ...v, message: e.target.value.slice(0, MAX_MESSAGE) }))}
                    placeholder={t("contact.form.messagePlaceholder")}
                    rows={5}
                    className={`${inputCls} resize-none ${errors.message ? inputErrCls : ""}`}
                  />
                  <FieldError message={errors.message} />
                </div>

                {submitError && (
                  <div className="flex items-start gap-2 rounded-xl border border-rose-100 bg-rose-50 px-3.5 py-3 text-sm text-rose-700 mt-4">
                    <AlertCircle className="w-4 h-4 flex-none mt-0.5" />
                    <span>{submitError}</span>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={sending}
                  className="mt-6 w-full flex items-center justify-center gap-2 rounded-xl bg-[#0F172A] hover:bg-gray-900 disabled:opacity-60 text-white font-semibold text-sm py-3 transition-colors"
                >
                  {sending ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      {t("contact.form.sending")}
                    </>
                  ) : (
                    <>
                      <Send className="w-4 h-4" />
                      {t("contact.form.submit")}
                    </>
                  )}
                </button>
              </form>
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
}
