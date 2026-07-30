import React, { useState } from 'react';
import { TopNav } from './TopNav';
import { Sidebar } from './Sidebar';
import { useUserPlan } from '../../lib/plan';

interface LayoutProps {
  children: React.ReactNode;
}

export function Layout({ children }: LayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { loggedIn, loading } = useUserPlan();

  // Every link in the Sidebar points at a route that now requires a session
  // (see routes.tsx's requireAuth loaders), so for a confirmed signed-out
  // visitor — e.g. on /pricing, the one page Layout renders for them — the
  // menu would only lead to a bounce straight back. Optimistic during
  // `loading` so a signed-in user doesn't see their own nav flash away.
  const showAppNav = loading || loggedIn;

  return (
    <div className="flex min-h-screen flex-col bg-[#F8F9FA] font-sans antialiased text-[#0F172A]">
      <TopNav
        onMenuToggle={showAppNav ? () => setSidebarOpen((o) => !o) : undefined}
        showMenuToggle={showAppNav}
      />

      {/* Backdrop — sits below sidebar, above content, covers area under TopNav only */}
      {showAppNav && sidebarOpen && (
        <div
          className="fixed left-0 right-0 top-16 bottom-0 z-30 bg-black/30 backdrop-blur-[1px]"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {showAppNav && <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />}

      <main className="flex-1 w-full max-w-full overflow-x-hidden">
        {children}
      </main>
    </div>
  );
}
