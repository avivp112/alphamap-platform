import React from 'react';
import { NavLink } from 'react-router';
import {
  Home, LineChart, Newspaper, Wallet, BellRing,
  Settings, Rocket, BarChart2, TrendingUp, X, Layers,
} from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const linkedItems = [
  { icon: Home,       label: 'Home',     to: '/dashboard', end: true  },
  { icon: LineChart,  label: 'VCs',      to: '/vcs',       end: false },
  { icon: Rocket,     label: 'Startups', to: '/startups',  end: false },
  { icon: Layers,     label: 'Deals',    to: '/deals',     end: false },
  { icon: TrendingUp, label: 'IPOs',     to: '/ipos',      end: false },
  { icon: BarChart2,  label: 'Stocks',   to: '/stocks',    end: false },
];

const staticItems = [
  { icon: Newspaper, label: 'News' },
  { icon: Wallet,    label: 'My Portfolio' },
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
        "fixed left-0 top-16 bottom-0 w-64 z-40",
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

      <nav className="flex flex-col gap-1 p-4 pt-10">
        {linkedItems.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              onClick={onClose}
              className={({ isActive }) => cn(
                "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200 ease-in-out",
                isActive
                  ? "bg-[#F3F4F6] text-[#111827] font-semibold"
                  : "text-gray-500 hover:bg-gray-50 hover:text-[#111827]",
              )}
            >
              {({ isActive }) => (
                <>
                  <Icon className={cn(
                    "h-5 w-5 transition-colors duration-200",
                    isActive ? "text-[#F59E0B]" : "text-gray-400",
                  )} />
                  {item.label}
                </>
              )}
            </NavLink>
          );
        })}

        <div className="my-2 h-px bg-gray-100" />

        {staticItems.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.label}
              className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-gray-400 cursor-default"
            >
              <Icon className="h-5 w-5 text-gray-300" />
              {item.label}
            </button>
          );
        })}
      </nav>

      <div className="p-4 border-t border-gray-100">
        <button className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-gray-500 hover:bg-gray-50 hover:text-[#111827] transition-all duration-200 ease-in-out group">
          <Settings className="h-5 w-5 text-gray-400 group-hover:text-[#111827]" />
          Settings
        </button>
      </div>
    </aside>
  );
}
