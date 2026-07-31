import React, { useEffect, useState } from 'react';
import { useTranslation } from "react-i18next";
import { Globe2, MapPin, Building2, Activity, HelpCircle } from 'lucide-react';
import { Layout } from '../components/Layout';
import { GlobalTechHubMap, type SectorKey } from '../components/GlobalTechHubMap';
import { MarketIntelligenceHub } from '../components/MarketIntelligenceHub';
import { ProductTour, type TourStep } from '../components/ProductTour';
import { fetchStartups, fetchInvestors, type Startup, type InvestorRow } from '../../lib/supabase';

const TOUR_SEEN_KEY = "alphamap_tour_marketmap_seen";

export function MarketMap() {
  const { t } = useTranslation();
  const [startups, setStartups] = useState<Startup[]>([]);
  const [investors, setInvestors] = useState<InvestorRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedHub, setSelectedHub] = useState<string | null>(null);
  const [sector, setSector] = useState<SectorKey>('all');

  // First-time visitors get the walkthrough automatically, once; anyone else
  // can replay it from the "?" button next to the page title.
  const [tourOpen, setTourOpen] = useState(false);
  useEffect(() => {
    if (!localStorage.getItem(TOUR_SEEN_KEY)) setTourOpen(true);
  }, []);
  function closeTour() {
    localStorage.setItem(TOUR_SEEN_KEY, "1");
    setTourOpen(false);
  }
  const tourSteps: TourStep[] = [
    { target: '[data-tour="sector-filter"]',      icon: Globe2,    title: t("tour.marketMap.steps.sector.title"),   description: t("tour.marketMap.steps.sector.body") },
    { target: '[data-tour="hub-map"]',             icon: MapPin,    title: t("tour.marketMap.steps.map.title"),      description: t("tour.marketMap.steps.map.body") },
    { target: '[data-tour="hub-panel"]',           icon: Building2, title: t("tour.marketMap.steps.panel.title"),    description: t("tour.marketMap.steps.panel.body") },
    { target: '[data-tour="market-intelligence"]', icon: Activity,  title: t("tour.marketMap.steps.insights.title"), description: t("tour.marketMap.steps.insights.body") },
  ];

  useEffect(() => {
    Promise.all([fetchStartups(), fetchInvestors()])
      .then(([s, i]) => { setStartups(s); setInvestors(i); })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  return (
    <Layout>
      <div className="mx-auto max-w-[1400px] p-4 sm:p-6 lg:p-8">
        <div className="mb-8 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-[#0F172A]">{t("marketMap.title")}</h1>
            <p className="mt-1 sm:mt-2 text-sm font-medium text-gray-500">{t("marketMap.subtitle")}</p>
          </div>
          <button
            onClick={() => setTourOpen(true)}
            title={t("tour.takeTour")}
            aria-label={t("tour.takeTour")}
            className="flex-none p-2 rounded-[12px] bg-gray-50 border border-gray-100 text-gray-400 hover:text-[#0F172A] hover:bg-white transition-all"
          >
            <HelpCircle className="w-4 h-4" />
          </button>
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

      <ProductTour steps={tourSteps} open={tourOpen} onClose={closeTour} />
    </Layout>
  );
}
