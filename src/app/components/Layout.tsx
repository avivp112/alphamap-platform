import React from 'react';
import { TopNav } from './TopNav';
import { NavBar } from './NavBar';
import { useUserPlan } from '../../lib/plan';

interface LayoutProps {
  children: React.ReactNode;
}

export function Layout({ children }: LayoutProps) {
  const { loggedIn, loading } = useUserPlan();

  // Every link in the NavBar points at a route that now requires a session
  // (see routes.tsx's requireAuth loaders), so for a confirmed signed-out
  // visitor — e.g. on /pricing, the one page Layout renders for them — the
  // nav would only lead to a bounce straight back. Optimistic during
  // `loading` so a signed-in user doesn't see their own nav flash away.
  const showAppNav = loading || loggedIn;

  return (
    <div className="flex min-h-screen flex-col bg-[#F8F9FA] font-sans antialiased text-[#0F172A]">
      <TopNav />

      {showAppNav && <NavBar />}

      <main className="flex-1 w-full max-w-full overflow-x-hidden">
        {children}
      </main>
    </div>
  );
}
