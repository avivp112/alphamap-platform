import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Bell, User, Menu, ChevronDown, UserCircle, LogOut } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { homePathNow } from '../../lib/navHome';
import { BrandMark, BrandWordmark } from './BrandMark';
import { LanguageSelector } from './LanguageSelector';

interface TopNavProps {
  onMenuToggle?: () => void;
  showMenuToggle?: boolean;
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

export function TopNav({ onMenuToggle, showMenuToggle = true }: TopNavProps) {
  const { t } = useTranslation();
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

  const displayName = user?.name || user?.email || "";
  const initials = user ? getInitials(user) : null;

  return (
    <header className="sticky top-0 z-30 flex h-16 w-full items-center justify-between border-b border-white bg-white px-4 lg:px-6 shadow-sm">
      {/* Hamburger & Logo */}
      <div className="flex items-center gap-3">
        {showMenuToggle && (
          <button
            onClick={onMenuToggle}
            className="p-2 text-gray-500 hover:bg-gray-100 rounded-md transition-colors"
            aria-label={t('nav.toggleNavigation')}
          >
            <Menu className="h-6 w-6" />
          </button>
        )}
        {/* Was a plain <div>, so clicking it did nothing — the one thing every
            visitor tries when they want to get back. */}
        <button
          type="button"
          onClick={async () => navigate(await homePathNow("/"))}
          aria-label={t('nav.goHome')}
          className="flex items-center gap-2 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/30"
        >
          <BrandMark size={32} />
          <BrandWordmark className="text-xl tracking-tight text-[#111827] hidden sm:block" />
        </button>
      </div>

      {/* Profile & Notifications */}
      <div className="flex items-center gap-2 sm:gap-4">
        {/* Available signed in or out — a visitor reading the marketing copy
            needs the switcher just as much as an account holder. */}
        <LanguageSelector />

        {loadingUser ? (
          // Brief loading flash while the session is checked — neutral, no
          // assumption either way about whether the visitor is signed in.
          <div className="h-9 w-9 rounded-full bg-gray-100 animate-pulse" />
        ) : user ? (
          <>
            <button
              aria-label={t('header.notifications')}
              className="relative rounded-full p-2 text-gray-500 hover:bg-gray-100 hover:text-[#111827] transition-colors"
            >
              <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-[#F59E0B] ring-2 ring-white" />
              <Bell className="h-5 w-5" />
            </button>
            <div className="hidden sm:block h-8 w-px bg-gray-200 mx-1" />

            <div className="relative" ref={menuRef}>
              <button
                onClick={() => setMenuOpen((o) => !o)}
                aria-expanded={menuOpen}
                aria-haspopup="menu"
                aria-label={t('header.accountMenu')}
                className="flex items-center gap-2 rounded-full border border-gray-200 p-1 pr-2.5 hover:bg-gray-50 transition-colors"
              >
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-100 flex-none">
                  {initials ? (
                    <span className="text-[11px] font-bold text-[#0F172A]">{initials}</span>
                  ) : (
                    <User className="h-4 w-4 text-gray-600" />
                  )}
                </div>
                <span className="hidden sm:block max-w-[140px] truncate text-sm font-medium text-[#111827]">
                  {displayName}
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
                    {t('header.profile')}
                  </Link>
                  <button
                    onClick={handleSignOut}
                    disabled={signingOut}
                    role="menuitem"
                    className="flex w-full items-center gap-2.5 px-3.5 py-2 text-sm text-rose-600 hover:bg-rose-50 disabled:opacity-50 transition-colors"
                  >
                    <LogOut className="h-4 w-4" />
                    {signingOut ? t('header.signingOut') : t('header.signOut')}
                  </button>
                </div>
              )}
            </div>
          </>
        ) : (
          // Not signed in — no account menu, no notifications. Just the two
          // real next steps for a visitor.
          <div className="flex items-center gap-2">
            <Link
              to="/login"
              className="rounded-full px-3.5 py-2 text-sm font-semibold text-[#111827] hover:bg-gray-50 transition-colors"
            >
              {t('header.logIn')}
            </Link>
            <Link
              to="/signup"
              className="rounded-full bg-[#0F172A] px-4 py-2 text-sm font-semibold text-white hover:bg-gray-900 transition-colors"
            >
              {t('header.signUp')}
            </Link>
          </div>
        )}
      </div>
    </header>
  );
}
