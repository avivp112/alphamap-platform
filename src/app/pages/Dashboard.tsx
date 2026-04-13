import React from 'react';
import { TopNav } from '../components/TopNav';
import { Sidebar } from '../components/Sidebar';
import { MarketOverview } from '../components/MarketOverview';
import { IntelligenceFeed } from '../components/IntelligenceFeed';

export function Dashboard() {
  return (
    <div className="flex min-h-screen flex-col bg-[#F3F4F6] font-sans antialiased text-[#111827]">
      <TopNav />
      
      <div className="flex flex-1">
        <Sidebar />
        
        {/* Main Content Area - padded left by sidebar width on desktop */}
        <main className="flex-1 lg:ml-64 w-full max-w-full overflow-x-hidden">
          <div className="mx-auto max-w-[1400px] p-4 sm:p-6 lg:p-8">
            {/* Page Header */}
            <div className="mb-8 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-[#111827]">
                  Dashboard
                </h1>
                <p className="mt-1 sm:mt-2 text-sm text-gray-500">
                  Real-time insights and portfolio overview.
                </p>
              </div>
              
              <div className="flex items-center gap-3">
                <button className="flex-1 sm:flex-none rounded-xl border border-gray-200 bg-white px-4 py-2 sm:py-2.5 text-sm font-semibold text-[#111827] shadow-sm hover:bg-gray-50 transition-colors">
                  Export
                </button>
                <button className="flex-1 sm:flex-none rounded-xl bg-[#111827] px-4 py-2 sm:py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-gray-900 transition-colors">
                  Customize
                </button>
              </div>
            </div>

            {/* Dashboard Grid */}
            <div className="grid grid-cols-1 gap-6 lg:gap-8 xl:grid-cols-3">
              <div className="xl:col-span-2 flex flex-col gap-6 lg:gap-8">
                <MarketOverview />
              </div>
              
              <div className="xl:col-span-1 flex flex-col gap-6 lg:gap-8">
                <IntelligenceFeed />
              </div>
            </div>
            
          </div>
        </main>
      </div>
    </div>
  );
}
