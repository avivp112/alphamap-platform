import React from 'react';
import { useTranslation } from "react-i18next";
import { TrendingUp } from 'lucide-react';
import { Layout } from '../components/Layout';

export function IPOs() {
  const { t } = useTranslation();
  return (
    <Layout>
      <div className="mx-auto max-w-[1400px] p-4 sm:p-6 lg:p-8">
        <div className="mb-8">
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-[#0F172A]">{t("ipos.title")}</h1>
          <p className="mt-2 text-sm font-medium text-gray-500">{t("ipos.subtitle")}</p>
        </div>

        <div className="flex flex-col items-center justify-center py-32 text-center">
          <div className="w-16 h-16 rounded-lg bg-amber-50 flex items-center justify-center mb-6">
            <TrendingUp className="w-7 h-7 text-[#F59E0B]" />
          </div>
          <h2 className="text-xl font-bold text-[#0F172A] mb-3">{t("ipos.comingSoon")}</h2>
          <p className="text-sm text-gray-400 max-w-sm leading-relaxed">{t("ipos.blurb")}</p>
        </div>
      </div>
    </Layout>
  );
}
