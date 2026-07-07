import React, { useState } from 'react';
import { TopNav } from './TopNav';
import { Sidebar } from './Sidebar';

interface LayoutProps {
  children: React.ReactNode;
}

export function Layout({ children }: LayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="flex min-h-screen flex-col bg-[#F8F9FA] font-sans antialiased text-[#0F172A]">
      <TopNav onMenuToggle={() => setSidebarOpen((o) => !o)} />

      {/* Backdrop — sits below sidebar, above content, covers area under TopNav only */}
      {sidebarOpen && (
        <div
          className="fixed left-0 right-0 top-16 bottom-0 z-30 bg-black/30 backdrop-blur-[1px]"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <main className="flex-1 w-full max-w-full overflow-x-hidden">
        {children}
      </main>
    </div>
  );
}
