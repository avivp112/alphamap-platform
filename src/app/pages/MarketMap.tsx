import React, { useEffect, useState } from 'react';
import { Layout } from '../components/Layout';
import { GlobalTechHubMap, type SectorKey } from '../components/GlobalTechHubMap';
import { MarketIntelligenceHub } from '../components/MarketIntelligenceHub';
import { fetchStartups, fetchInvestors, type Startup, type InvestorRow } from '../../lib/supabase';

export function MarketMap() {
  const [startups, setStartups] = useState<Startup[]>([]);
  const [investors, setInvestors] = useState<InvestorRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedHub, setSelectedHub] = useState<string | null>(null);
  const [sector, setSector] = useState<SectorKey>('all');

  useEffect(() => {
    Promise.all([fetchStartups(), fetchInvestors()])
      .then(([s, i]) => { setStartups(s); setInvestors(i); })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

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

        <GlobalTechHubMap
          startups={startups}
          investors={investors}
          loading={loading}
          selectedHub={selectedHub}
          onSelectHub={setSelectedHub}
          sector={sector}
          onSectorChange={setSector}
        />

        <div className="mt-8">
          <MarketIntelligenceHub
            startups={startups}
            investors={investors}
            loading={loading}
            selectedHub={selectedHub}
            sector={sector}
          />
        </div>
      </div>
    </Layout>
  );
}
