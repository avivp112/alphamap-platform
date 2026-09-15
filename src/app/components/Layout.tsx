import React from 'react';
import { TopNav } from './TopNav';

interface LayoutProps {
  children: React.ReactNode;
}

export function Layout({ children }: LayoutProps) {
  return (
    <div className="flex min-h-screen flex-col bg-[#F8F9FA] font-sans antialiased text-[#0F172A] native:pb-[env(safe-area-inset-bottom)]">
      <TopNav />

      <main className="flex-1 w-full max-w-full overflow-x-hidden">
        {children}
      </main>
    </div>
  );
}
