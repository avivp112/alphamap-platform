import React from 'react';
import { Layout } from '../components/Layout';
import { MarketOverview } from '../components/MarketOverview';
import { IntelligenceFeed } from '../components/IntelligenceFeed';
import { AIMarketStory, CrossMarketSignalsBar, PortfolioInsight } from '../components/AIMarketInsights';

export function Dashboard() {
  return (
    <Layout>
      <div className="mx-auto max-w-[1400px] p-4 sm:p-6 lg:p-8">
            {/* Page Header */}
            <div className="mb-8 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-[#0F172A]">
                  Market Intelligence
                </h1>
                <p className="mt-1 sm:mt-2 text-sm font-medium text-gray-500">
                  Top-down view of capital flow, VC, and public markets.
                </p>
              </div>
              
              <div className="flex items-center gap-3">
                <button className="flex-1 sm:flex-none rounded-[16px] border border-gray-200 bg-white px-4 py-2.5 text-xs font-bold uppercase tracking-widest text-[#0F172A] shadow-[0_4px_20px_rgba(0,0,0,0.02)] hover:bg-gray-50 transition-colors">
                  Export Report
                </button>
                <button className="flex-1 sm:flex-none rounded-[16px] bg-[#0F172A] px-4 py-2.5 text-xs font-bold uppercase tracking-widest text-white shadow-[0_4px_20px_rgba(0,0,0,0.06)] hover:bg-gray-900 transition-colors">
                  Customize View
                </button>
              </div>
            </div>

            {/* Dashboard Grid */}
            <div className="grid grid-cols-1 gap-6 lg:gap-8 xl:grid-cols-3">
              {/* Left Column (2/3 width) */}
              <div className="xl:col-span-2 flex flex-col gap-6 lg:gap-8">
                <AIMarketStory />
                <CrossMarketSignalsBar />
                <MarketOverview />
              </div>
              
              {/* Right Column (1/3 width) */}
              <div className="xl:col-span-1 flex flex-col gap-6 lg:gap-8">
                <PortfolioInsight />
                <IntelligenceFeed />
              </div>
            </div>
            
          </div>
    </Layout>
  );
}
