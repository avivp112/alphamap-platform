import React from "react";
import { Home, LineChart, Rocket, Newspaper, Wallet, BellRing, Settings } from "lucide-react";
import { NavLink } from "react-router";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const navItems = [
  { icon: Home, label: "Home", to: "/dashboard" },
  { icon: LineChart, label: "Markets", to: "/markets" },
  { icon: Rocket, label: "Startups", to: "/startups" },
  { icon: Newspaper, label: "News", to: "/dashboard" },
  { icon: Wallet, label: "My Portfolio", to: "/dashboard" },
  { icon: BellRing, label: "Alerts", to: "/dashboard" },
];

export function Sidebar() {
  return (
    <aside className="hidden lg:flex fixed left-0 top-16 bottom-0 w-64 border-r border-gray-200 bg-white flex-col justify-between overflow-y-auto z-20">
      <nav className="flex flex-col gap-1 p-4">
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.label}
              to={item.to}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200 ease-in-out group",
                  isActive
                    ? "bg-[#F3F4F6] text-[#111827] font-semibold"
                    : "text-gray-500 hover:bg-gray-50 hover:text-[#111827]",
                )
              }
            >
              {({ isActive }) => (
                <>
                  <Icon
                    className={cn(
                      "h-5 w-5 transition-colors duration-200",
                      isActive
                        ? "text-[#F59E0B]"
                        : "text-gray-400 group-hover:text-[#111827]",
                    )}
                  />
                  {item.label}
                </>
              )}
            </NavLink>
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
