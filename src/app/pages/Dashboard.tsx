import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Layout } from '../components/Layout';
import { AISearchWorkspace } from '../components/AISearchWorkspace';
import { resolveUiV2 } from '../../lib/uiFlag';

export function Dashboard() {
  const [params, setParams] = useSearchParams();
  // The redesigned Home is off unless ?ui=2 (see lib/uiFlag.ts), the same switch as the other pages.
  const [redesign] = useState(() => resolveUiV2(params.get('ui')));
  // /dashboard?q=... asks that question once (the Ctrl+K "Ask AlphaMap" entry); the URL is then cleaned.
  const [initialQuery] = useState(() => params.get('q'));
  useEffect(() => {
    if (initialQuery === null) return;
    setParams((p) => { p.delete('q'); return p; }, { replace: true });
  }, [initialQuery, setParams]);

  return (
    <Layout>
      <div className="mx-auto max-w-[1400px] p-4 sm:p-6 lg:p-8">
        <AISearchWorkspace redesign={redesign} initialQuery={initialQuery} />
      </div>
    </Layout>
  );
}
