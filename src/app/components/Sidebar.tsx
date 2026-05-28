import React from 'react';
import { Home, LineChart, Newspaper, Wallet, BellRing, Settings } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function Sidebar() {
  const navItems = [
    { icon: Home, label: 'Home', active: true },
    { icon: LineChart, label: 'Markets', active: false },
    { icon: Newspaper, label: 'News', active: false },
    { icon: Wallet, label: 'My Portfolio', active: false },
    { icon: BellRing, label: 'Alerts', active: false },
  ];

  return (
    <aside className="hidden lg:flex fixed left-0 top-16 bottom-0 w-64 border-r border-gray-200 bg-white flex-col justify-between overflow-y-auto z-20">
      <nav className="flex flex-col gap-1 p-4">
        {navItems.map((item, index) => {
          const Icon = item.icon;
          return (
            <button
              key={index}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200 ease-in-out group",
                item.active 
                  ? "bg-[#F3F4F6] text-[#111827] font-semibold" 
                  : "text-gray-500 hover:bg-gray-50 hover:text-[#111827]"
              )}
            >
              <Icon className={cn(
                "h-5 w-5 transition-colors duration-200",
                item.active ? "text-[#F59E0B]" : "text-gray-400 group-hover:text-[#111827]"
              )} />
              {item.label}
            </button>
          );
        })}
      </nav>

      <div className="p-4 border-t border-gray-100 mt-auto">
        <button className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-gray-500 hover:bg-gray-50 hover:text-[#111827] transition-all duration-200 ease-in-out group">
          <Settings className="h-5 w-5 text-gray-400 group-hover:text-[#111827]" />
          Settings
        </button>
      </div>
    </aside>
  );
}
