import React from 'react';
import { TopNav } from './TopNav';

interface LayoutProps {
  children: React.ReactNode;
}

export function Layout({ children }: LayoutProps) {
  return (
    <div className="flex min-h-screen flex-col bg-am-canvas font-sans antialiased text-am-ink native:pb-[env(safe-area-inset-bottom)]">
      <TopNav />

      <main className="flex-1 w-full max-w-full overflow-x-hidden">
        {children}
      </main>
    </div>
  );
}
