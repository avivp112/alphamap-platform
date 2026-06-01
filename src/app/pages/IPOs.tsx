import React from 'react';
import { TrendingUp } from 'lucide-react';
import { Layout } from '../components/Layout';

export function IPOs() {
  return (
    <Layout>
      <div className="mx-auto max-w-[1400px] p-4 sm:p-6 lg:p-8">
        <div className="mb-8">
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-[#0F172A]">
            IPO Pipeline
          </h1>
          <p className="mt-2 text-sm font-medium text-gray-500">
            Companies approaching public markets — pre-IPO intelligence and S-1 filings.
          </p>
        </div>

        <div className="flex flex-col items-center justify-center py-32 text-center">
          <div className="w-16 h-16 rounded-3xl bg-amber-50 flex items-center justify-center mb-6">
            <TrendingUp className="w-7 h-7 text-[#F59E0B]" />
          </div>
          <h2 className="text-xl font-bold text-[#0F172A] mb-3">Coming Soon</h2>
          <p className="text-sm text-gray-400 max-w-sm leading-relaxed">
            IPO pipeline tracking, S-1 analysis, and lock-up expiry alerts are under development.
          </p>
        </div>
      </div>
    </Layout>
  );
}
