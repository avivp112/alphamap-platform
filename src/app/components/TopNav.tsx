import React from 'react';
import { Search, Bell, User, Menu } from 'lucide-react';

export function TopNav() {
  return (
    <header className="sticky top-0 z-30 flex h-16 w-full items-center justify-between border-b border-gray-200 bg-white px-4 lg:px-6 shadow-sm">
      {/* Mobile Menu & Logo */}
      <div className="flex items-center gap-3">
        <button className="lg:hidden p-2 text-gray-500 hover:bg-gray-100 rounded-md">
          <Menu className="h-6 w-6" />
        </button>
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#111827] text-white">
            <div className="h-4 w-4 rounded-sm border-2 border-white/80 bg-transparent" />
          </div>
          <span className="text-xl font-bold tracking-tight text-[#111827] hidden sm:block">
            Unified Wealth
          </span>
        </div>
      </div>

      {/* Search Bar */}
      <div className="hidden md:flex flex-1 items-center justify-center px-8">
        <div className="relative w-full max-w-2xl">
          <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
            <Search className="h-4 w-4 text-gray-400" />
          </div>
          <input
            type="text"
            className="block w-full rounded-full border-0 bg-[#F3F4F6] py-2 pl-10 pr-4 text-sm text-[#111827] placeholder:text-gray-500 focus:bg-white focus:ring-2 focus:ring-[#F59E0B] sm:text-sm sm:leading-6 transition-all duration-200 ease-in-out"
            placeholder="Search Stocks, VCs, Startups"
          />
        </div>
      </div>

      {/* Profile & Notifications */}
      <div className="flex items-center gap-2 sm:gap-4">
        <button className="md:hidden rounded-full p-2 text-gray-500 hover:bg-gray-100 hover:text-[#111827] transition-colors">
          <Search className="h-5 w-5" />
        </button>
        <button className="relative rounded-full p-2 text-gray-500 hover:bg-gray-100 hover:text-[#111827] transition-colors">
          <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-[#F59E0B] ring-2 ring-white" />
          <Bell className="h-5 w-5" />
        </button>
        <div className="hidden sm:block h-8 w-px bg-gray-200 mx-1" />
        <button className="flex items-center gap-2 rounded-full border border-gray-200 p-1 pr-3 hover:bg-gray-50 transition-colors">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-100">
            <User className="h-4 w-4 text-gray-600" />
          </div>
          <span className="hidden sm:block text-sm font-medium text-[#111827]">A. Smith</span>
        </button>
      </div>
    </header>
  );
}
