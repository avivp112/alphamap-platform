import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, Link } from 'react-router';
import { Search, Bell, User, Menu, ChevronDown, UserCircle, LogOut } from 'lucide-react';
import { supabase } from '../../lib/supabase';

interface TopNavProps {
  onMenuToggle?: () => void;
}

interface AuthedUser {
  name: string | null;
  email: string | null;
}

function getInitials({ name, email }: AuthedUser): string {
  if (name && name.trim()) {
    const parts = name.trim().split(/\s+/);
    return parts.length === 1
      ? parts[0].slice(0, 2).toUpperCase()
      : (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  if (email) return email.slice(0, 2).toUpperCase();
  return "?";
}

export function TopNav({ onMenuToggle }: TopNavProps) {
  const navigate = useNavigate();
  const [user, setUser]           = useState<AuthedUser | null>(null);
  const [loadingUser, setLoading] = useState(true);
  const [menuOpen, setMenuOpen]   = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;

    supabase.auth.getUser().then(({ data, error }) => {
      if (cancelled) return;
      if (error || !data.user) { setUser(null); setLoading(false); return; }
      setUser({
        name: (data.user.user_metadata?.full_name as string | undefined)?.trim() || null,
        email: data.user.email ?? null,
      });
      setLoading(false);
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      if (cancelled) return;
      if (!session?.user) { setUser(null); return; }
      setUser({
        name: (session.user.user_metadata?.full_name as string | undefined)?.trim() || null,
        email: session.user.email ?? null,
      });
    });

    return () => { cancelled = true; subscription.subscription.unsubscribe(); };
  }, []);

  // Close the dropdown on an outside click or Escape.
  useEffect(() => {
    if (!menuOpen) return;
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [menuOpen]);

  async function handleSignOut() {
    setSigningOut(true);
    try {
      await supabase.auth.signOut();
    } finally {
      navigate("/login");
    }
  }

  const displayName = user?.name || user?.email || (loadingUser ? "" : "Account");
  const initials = user ? getInitials(user) : null;

  return (
    <header className="sticky top-0 z-30 flex h-16 w-full items-center justify-between border-b border-gray-200 bg-white px-4 lg:px-6 shadow-sm">
      {/* Hamburger & Logo */}
      <div className="flex items-center gap-3">
        <button
          onClick={onMenuToggle}
          className="p-2 text-gray-500 hover:bg-gray-100 rounded-md transition-colors"
          aria-label="Toggle navigation"
        >
          <Menu className="h-6 w-6" />
        </button>
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#0F172A]">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="#FFFFFF"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="w-[18px] h-[18px]"
            >
              <path d="M15 8 C12 8 9 12 7 15 A4 4 0 1 1 8 8 C11 8 14 13 16 16 C17.5 18 19 12 20 6" />
              <polyline points="15 6 20 6 20 11" />
            </svg>
          </div>
          <span className="text-xl font-bold tracking-tight text-[#111827] hidden sm:block">
            AlphaMap
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
            className="block w-full rounded-full border-0 bg-[#F3F4F6] py-2 pl-10 pr-4 text-sm text-[#111827] placeholder:text-gray-500 focus:bg-white focus:ring-2 focus:ring-[#0F172A]/20 sm:text-sm sm:leading-6 transition-all duration-200 ease-in-out"
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

        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setMenuOpen((o) => !o)}
            aria-expanded={menuOpen}
            aria-haspopup="menu"
            className="flex items-center gap-2 rounded-full border border-gray-200 p-1 pr-2.5 hover:bg-gray-50 transition-colors"
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-100 flex-none">
              {loadingUser ? (
                <div className="h-3.5 w-3.5 rounded-full bg-gray-200 animate-pulse" />
              ) : initials ? (
                <span className="text-[11px] font-bold text-[#0F172A]">{initials}</span>
              ) : (
                <User className="h-4 w-4 text-gray-600" />
              )}
            </div>
            <span className="hidden sm:block max-w-[140px] truncate text-sm font-medium text-[#111827]">
              {loadingUser ? (
                <span className="inline-block h-3.5 w-16 rounded bg-gray-100 animate-pulse" />
              ) : (
                displayName
              )}
            </span>
            <ChevronDown className="hidden sm:block h-3.5 w-3.5 text-gray-400 flex-none" />
          </button>

          {menuOpen && (
            <div
              role="menu"
              className="absolute right-0 top-[calc(100%+8px)] w-56 rounded-xl border border-gray-100 bg-white py-1.5 shadow-[0_12px_32px_rgba(15,23,42,0.12)]"
            >
              {(user?.name || user?.email) && (
                <div className="px-3.5 py-2 mb-1 border-b border-gray-100">
                  {user?.name && <p className="text-sm font-semibold text-[#111827] truncate">{user.name}</p>}
                  {user?.email && <p className="text-xs text-gray-400 truncate">{user.email}</p>}
                </div>
              )}
              <Link
                to="/profile"
                onClick={() => setMenuOpen(false)}
                role="menuitem"
                className="flex items-center gap-2.5 px-3.5 py-2 text-sm text-[#111827] hover:bg-gray-50 transition-colors"
              >
                <UserCircle className="h-4 w-4 text-gray-400" />
                Profile
              </Link>
              <button
                onClick={handleSignOut}
                disabled={signingOut}
                role="menuitem"
                className="flex w-full items-center gap-2.5 px-3.5 py-2 text-sm text-rose-600 hover:bg-rose-50 disabled:opacity-50 transition-colors"
              >
                <LogOut className="h-4 w-4" />
                {signingOut ? "Signing out…" : "Sign Out"}
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
