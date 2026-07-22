import React from 'react';
import { NavLink } from 'react-router';
import {
  LayoutDashboard, Rocket, CandlestickChart, Landmark, Vault, Handshake,
  Globe2, ClipboardCheck, Eye, Settings, X,
} from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Real, navigable pages. Pricing is deliberately NOT here — it's reached via
// the sign-up CTAs on the landing page (View Dashboard / Request Early
// Access), not persistent nav, since it's not meant to be a standing menu item
// during this controlled rollout.
const linkedItems = [
  { icon: LayoutDashboard,  label: 'Home',            to: '/dashboard',  end: true  },
  { icon: Rocket,           label: 'Private Market',  to: '/startups',   end: false },
  { icon: CandlestickChart, label: 'Public Market',   to: '/stocks',     end: false },
  { icon: Landmark,         label: 'Venture Capital', to: '/vcs',        end: false },
  { icon: Handshake,        label: 'Deals',           to: '/deals',      end: false },
  { icon: Globe2,           label: 'Market Map',      to: '/market-map', end: false },
  { icon: Vault,            label: 'Private Equity',  to: '/private-equity', end: false },
  { icon: Eye,              label: 'My Watchlist',    to: '/watchlist',  end: false },
];

// Not built yet — shown dimmed and inert so the full nav is visible without
// implying these pages already work.
const staticItems = [
  { icon: ClipboardCheck, label: 'Valuations and Due Diligence' },
];

interface SidebarProps {
  open: boolean;
  onClose: () => void;
}

export function Sidebar({ open, onClose }: SidebarProps) {
  return (
    <aside
      className={cn(
        "fixed left-0 top-16 bottom-0 w-72 z-40",
        "border-r border-gray-200 bg-white flex flex-col justify-between overflow-y-auto",
        "transform transition-transform duration-300 ease-in-out",
        open ? "translate-x-0 shadow-[4px_0_24px_rgba(0,0,0,0.08)]" : "-translate-x-full",
      )}
    >
      {/* Close button */}
      <button
        onClick={onClose}
        className="absolute top-3 right-3 p-1.5 rounded-md text-gray-400 hover:bg-gray-100 hover:text-gray-700 transition-colors"
        aria-label="Close navigation"
      >
        <X className="h-4 w-4" />
      </button>

      <nav className="p-4 pt-12">
        <div className="grid grid-cols-2 gap-3">
          {linkedItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                onClick={onClose}
                className={({ isActive }) => cn(
                  "relative flex flex-col items-center justify-center gap-2 aspect-square rounded-2xl border text-center px-1.5 transition-all duration-200",
                  isActive
                    ? "bg-[#F3F4F6] border-gray-200 shadow-sm"
                    : "bg-gray-50 border-gray-100 hover:bg-gray-100 hover:border-gray-200",
                )}
              >
                {({ isActive }) => (
                  <>
                    <Icon
                      strokeWidth={1.5}
                      className={cn(
                        "h-6 w-6 transition-colors duration-200",
                        isActive ? "text-[#0F172A]" : "text-gray-500",
                      )}
                    />
                    <span className={cn(
                      "text-[11px] font-semibold tracking-tight leading-tight transition-colors duration-200",
                      isActive ? "text-[#111827]" : "text-gray-600",
                    )}>
                      {item.label}
                    </span>
                  </>
                )}
              </NavLink>
            );
          })}
        </div>

        <div className="my-4 h-px bg-gray-100" />

        <div className="grid grid-cols-2 gap-3">
          {staticItems.map((item) => {
            const Icon = item.icon;
            return (
              <div
                key={item.label}
                aria-disabled="true"
                className="relative flex flex-col items-center justify-center gap-2 aspect-square rounded-2xl border border-gray-100 bg-gray-50/60 cursor-default select-none text-center px-1.5"
              >
                <span className="absolute top-2 right-2 text-[8px] font-bold uppercase tracking-wider text-gray-300 bg-white border border-gray-100 rounded-full px-1.5 py-0.5">
                  Soon
                </span>
                <Icon strokeWidth={1.5} className="h-6 w-6 text-gray-300" />
                <span className="text-[11px] font-semibold tracking-tight leading-tight text-gray-400">
                  {item.label}
                </span>
              </div>
            );
          })}
        </div>
      </nav>

      <div className="p-4 border-t border-gray-100 flex flex-col gap-3">
        <button className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-gray-500 hover:bg-gray-50 hover:text-[#111827] transition-all duration-200 ease-in-out group">
          <Settings strokeWidth={1.5} className="h-5 w-5 text-gray-400 group-hover:text-[#111827]" />
          Settings
        </button>
      </div>
    </aside>
  );
}
