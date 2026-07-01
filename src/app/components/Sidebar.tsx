import React from 'react';
import { NavLink } from 'react-router';
import {
  LayoutDashboard, Landmark, Rocket, Handshake, CandlestickChart, LineChart,
  Newspaper, Briefcase, BellRing, Settings, X,
} from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const linkedItems = [
  { icon: LayoutDashboard,  label: 'Home',     to: '/dashboard', end: true  },
  { icon: Landmark,         label: 'VCs',      to: '/vcs',       end: false },
  { icon: Rocket,           label: 'Startups', to: '/startups',  end: false },
  { icon: Handshake,        label: 'Deals',    to: '/deals',     end: false },
  { icon: CandlestickChart, label: 'IPOs',     to: '/ipos',      end: false },
  { icon: LineChart,        label: 'Stocks',   to: '/stocks',    end: false },
];

const staticItems = [
  { icon: Newspaper, label: 'News' },
  { icon: Briefcase, label: 'My Portfolio' },
  { icon: BellRing,  label: 'Alerts' },
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
        "border-r border-[#1a2a3f] bg-[#0b1626] flex flex-col justify-between overflow-y-auto",
        "transform transition-transform duration-300 ease-in-out",
        open ? "translate-x-0 shadow-[4px_0_32px_rgba(0,0,0,0.45)]" : "-translate-x-full",
      )}
    >
      {/* Close button */}
      <button
        onClick={onClose}
        className="absolute top-3 right-3 p-1.5 rounded-md text-slate-500 hover:bg-white/[0.06] hover:text-white transition-colors"
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
                  "relative flex flex-col items-center justify-center gap-2 aspect-square rounded-2xl border transition-all duration-200",
                  isActive
                    ? "bg-amber-500/10 border-amber-500/30 shadow-[0_0_0_1px_rgba(245,158,11,0.12),0_8px_24px_rgba(245,158,11,0.10)]"
                    : "bg-white/[0.02] border-white/[0.06] hover:bg-white/[0.06] hover:border-white/[0.14] backdrop-blur-sm",
                )}
              >
                {({ isActive }) => (
                  <>
                    <Icon
                      strokeWidth={1.5}
                      className={cn(
                        "h-6 w-6 transition-colors duration-200",
                        isActive ? "text-[#F59E0B]" : "text-slate-400",
                      )}
                    />
                    <span className={cn(
                      "text-[11px] font-semibold tracking-tight transition-colors duration-200",
                      isActive ? "text-white" : "text-slate-400",
                    )}>
                      {item.label}
                    </span>
                  </>
                )}
              </NavLink>
            );
          })}
        </div>

        <div className="my-4 h-px bg-white/[0.06]" />

        <div className="grid grid-cols-2 gap-3">
          {staticItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.label}
                className="flex flex-col items-center justify-center gap-2 aspect-square rounded-2xl border border-white/[0.04] bg-white/[0.01] cursor-default opacity-50"
              >
                <Icon strokeWidth={1.5} className="h-6 w-6 text-slate-500" />
                <span className="text-[11px] font-semibold tracking-tight text-slate-500">{item.label}</span>
              </button>
            );
          })}
        </div>
      </nav>

      <div className="p-4 border-t border-white/[0.06]">
        <button className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-slate-400 hover:bg-white/[0.06] hover:text-white transition-all duration-200 ease-in-out group">
          <Settings strokeWidth={1.5} className="h-5 w-5 text-slate-500 group-hover:text-[#F59E0B] transition-colors" />
          Settings
        </button>
      </div>
    </aside>
  );
}
