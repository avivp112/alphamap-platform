import React from 'react';
import { Layout } from '../components/Layout';
import { GlobalTechHubMap } from '../components/GlobalTechHubMap';

export function MarketMap() {
  return (
    <Layout>
      <div className="mx-auto max-w-[1400px] p-4 sm:p-6 lg:p-8">
        <div className="mb-8">
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-[#0F172A]">
            Market Map
          </h1>
          <p className="mt-1 sm:mt-2 text-sm font-medium text-gray-500">
            Cross-border capital flow across global tech ecosystems.
          </p>
        </div>

        <GlobalTechHubMap />
      </div>
    </Layout>
  );
}
