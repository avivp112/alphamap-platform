import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation, Link, NavLink } from 'react-router';
import { useTranslation } from 'react-i18next';
import {
  Bell, User, ChevronDown, UserCircle, LogOut, Menu, X,
  Rocket, CandlestickChart, Landmark, Vault, Handshake, Globe2, ClipboardCheck,
} from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { supabase } from '../../lib/supabase';
import { homePathNow } from '../../lib/navHome';
import { BrandMark, BrandWordmark } from './BrandMark';
import { LanguageSelector } from './LanguageSelector';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
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

// ── Primary nav (Home / Data / Market Map / My Watchlist) ───────────────────

interface NavItem {
  labelKey: string;
  to: string | null;
  icon: React.ElementType;
}

const DATA_ITEMS: NavItem[] = [
  { labelKey: 'nav.privateMarket',  to: '/startups',       icon: Rocket },
  { labelKey: 'nav.publicMarket',   to: '/public-market',  icon: CandlestickChart },
  { labelKey: 'nav.privateEquity',  to: '/private-equity', icon: Vault },
  { labelKey: 'nav.ventureCapital', to: '/vcs',            icon: Landmark },
];

// Valuations and Due Diligence has no `to` — not built yet. Rendered as an
// inert row with a "Soon" badge rather than omitted, so the menu's shape
// doesn't shift once it ships.
const MARKET_MAP_ITEMS: NavItem[] = [
  { labelKey: 'nav.marketMap', to: '/market-map', icon: Globe2 },
  { labelKey: 'nav.deals',     to: '/deals',       icon: Handshake },
  { labelKey: 'nav.valuationsDueDiligence', to: null, icon: ClipboardCheck },
];

type MenuId = 'data' | 'marketMap';

const topLinkCls =
  "relative px-3.5 py-2 text-sm font-medium transition-colors rounded-lg";
const topLinkActive = "text-[#0F172A] font-semibold";
const topLinkInactive = "text-gray-500 hover:text-[#0F172A] hover:bg-gray-50";

function ActiveIndicator({ show }: { show: boolean }) {
  return (
    <span
      className={cn(
        "pointer-events-none absolute left-3.5 right-3.5 bottom-0.5 h-[2px] rounded-full bg-[#0F172A] transition-opacity duration-150",
        show ? "opacity-100" : "opacity-0",
      )}
    />
  );
}

// Shared dropdown: opens on hover (with a short close delay so moving the
// cursor from the trigger into the panel doesn't close it) and opens on
// click too, so it works the same for a mouse, a touch tap, or a keyboard.
function NavDropdown({
  id, label, items, openMenu, onOpen, onCloseSoon, onSelect,
}: {
  id: MenuId;
  label: string;
  items: NavItem[];
  openMenu: MenuId | null;
  onOpen: (id: MenuId) => void;
  onCloseSoon: () => void;
  onSelect: () => void;
}) {
  const { t } = useTranslation();
  const location = useLocation();
  const open = openMenu === id;
  const isActive = items.some((it) => it.to && location.pathname === it.to);

  return (
    <div
      className="relative"
      onMouseEnter={() => onOpen(id)}
      onMouseLeave={onCloseSoon}
    >
      <button
        type="button"
        onClick={() => onOpen(id)}
        aria-expanded={open}
        aria-haspopup="menu"
        className={cn(topLinkCls, "flex items-center gap-1.5", isActive || open ? topLinkActive : topLinkInactive)}
      >
        {label}
        <ChevronDown className={cn("h-3.5 w-3.5 transition-transform duration-150", open && "rotate-180")} />
        <ActiveIndicator show={isActive} />
      </button>

      <div
        role="menu"
        className={cn(
          "absolute left-0 top-full mt-1.5 w-64 rounded-2xl border border-gray-100 bg-white py-2 shadow-[0_12px_32px_rgba(15,23,42,0.10)] transition-all duration-150 ease-out z-40",
          open ? "opacity-100 translate-y-0 pointer-events-auto" : "opacity-0 -translate-y-1 pointer-events-none",
        )}
      >
        {items.map(({ labelKey, to, icon: Icon }) => {
          if (!to) {
            return (
              <div
                key={labelKey}
                className="flex items-center justify-between gap-2.5 px-4 py-2.5 text-sm text-gray-400 cursor-default"
              >
                <span className="flex items-center gap-2.5">
                  <Icon className="h-4 w-4 text-gray-300" />
                  {t(labelKey)}
                </span>
                <span className="text-[9px] font-bold uppercase tracking-wider text-gray-300 bg-gray-50 border border-gray-100 rounded-full px-2 py-0.5">
                  {t('nav.soon')}
                </span>
              </div>
            );
          }
          return (
            <NavLink
              key={to}
              to={to}
              role="menuitem"
              onClick={onSelect}
              className={({ isActive: linkActive }) => cn(
                "flex items-center gap-2.5 px-4 py-2.5 text-sm transition-colors",
                linkActive ? "bg-gray-50 font-semibold text-[#0F172A]" : "text-[#111827] hover:bg-gray-50",
              )}
            >
              <Icon className="h-4 w-4 text-gray-400" />
              {t(labelKey)}
            </NavLink>
          );
        })}
      </div>
    </div>
  );
}

function MobileAccordion({
  label, items, expanded, onToggle, onSelect,
}: {
  label: string;
  items: NavItem[];
  expanded: boolean;
  onToggle: () => void;
  onSelect: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="border-b border-gray-100 last:border-b-0">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between py-3 text-sm font-semibold text-[#0F172A]"
      >
        {label}
        <ChevronDown className={cn("h-4 w-4 text-gray-400 transition-transform duration-150", expanded && "rotate-180")} />
      </button>
      {expanded && (
        <div className="pb-2 pl-3">
          {items.map(({ labelKey, to, icon: Icon }) => (
            to ? (
              <NavLink
                key={to}
                to={to}
                onClick={onSelect}
                className={({ isActive }) => cn(
                  "flex items-center gap-2.5 py-2.5 text-sm",
                  isActive ? "font-semibold text-[#0F172A]" : "text-gray-600",
                )}
              >
                <Icon className="h-4 w-4 text-gray-400" />
                {t(labelKey)}
              </NavLink>
            ) : (
              <div key={labelKey} className="flex items-center justify-between gap-2.5 py-2.5 text-sm text-gray-400">
                <span className="flex items-center gap-2.5">
                  <Icon className="h-4 w-4 text-gray-300" />
                  {t(labelKey)}
                </span>
                <span className="text-[9px] font-bold uppercase tracking-wider text-gray-300 bg-gray-50 border border-gray-100 rounded-full px-2 py-0.5">
                  {t('nav.soon')}
                </span>
              </div>
            )
          ))}
        </div>
      )}
    </div>
  );
}

export function TopNav() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const [user, setUser]           = useState<AuthedUser | null>(null);
  const [loadingUser, setLoading] = useState(true);
  const [menuOpen, setMenuOpen]   = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Primary nav (Data / Market Map dropdowns + mobile menu) state.
  const [openMenu, setOpenMenu] = useState<MenuId | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [mobileExpanded, setMobileExpanded] = useState<MenuId | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const navItemsRef = useRef<HTMLDivElement>(null);

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

  // Close the account dropdown on an outside click or Escape.
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

  // Every link in the primary nav points at a route that requires a session
  // (see routes.tsx's requireAuth loaders), so for a confirmed signed-out
  // visitor — e.g. on /pricing — it would only lead to a bounce straight
  // back. Optimistic during `loadingUser` so a signed-in user doesn't see
  // their own nav flash away.
  const showAppNav = loadingUser || !!user;

  function openNow(id: MenuId) {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setOpenMenu(id);
  }
  function closeSoon() {
    closeTimer.current = setTimeout(() => setOpenMenu(null), 150);
  }

  // Close everything on route change and on outside click/Escape — hover
  // handles the common desktop case, this covers keyboard and touch.
  useEffect(() => {
    setOpenMenu(null);
    setMobileOpen(false);
    setMobileExpanded(null);
  }, [location.pathname]);

  useEffect(() => {
    if (!openMenu) return;
    function handleClick(e: MouseEvent) {
      if (navItemsRef.current && !navItemsRef.current.contains(e.target as Node)) setOpenMenu(null);
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpenMenu(null);
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [openMenu]);

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
    <header className="sticky top-0 z-30 relative flex h-16 w-full items-center justify-between border-b border-white bg-white px-4 lg:px-6 shadow-sm">
      {/* Logo (+ mobile nav trigger) */}
      <div className="flex items-center gap-1 flex-none min-w-0">
        {/* Was a plain <div>, so clicking it did nothing — the one thing every
            visitor tries when they want to get back. */}
        <button
          type="button"
          onClick={async () => navigate(await homePathNow("/"))}
          aria-label={t('nav.goHome')}
          className="flex items-center gap-2 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0F172A]/30 flex-none"
        >
          <BrandMark size={32} />
          <BrandWordmark className="text-xl tracking-tight text-[#111827] hidden sm:block" />
        </button>

        {showAppNav && (
          <button
            type="button"
            onClick={() => setMobileOpen((o) => !o)}
            aria-expanded={mobileOpen}
            aria-label={t('nav.toggleNavigation')}
            className="flex md:hidden items-center p-2 ml-1 text-[#0F172A]"
          >
            {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        )}
      </div>

      {/* Primary nav — centered in the space between the logo and the
          right-side controls, rather than crowded against either. */}
      {showAppNav && (
        <div ref={navItemsRef} className="hidden md:flex flex-1 items-center justify-center gap-0.5">
          <NavLink
            to="/dashboard"
            end
            className={({ isActive }) => cn(topLinkCls, isActive ? topLinkActive : topLinkInactive)}
          >
            {({ isActive }) => (
              <>
                {t('nav.home')}
                <ActiveIndicator show={isActive} />
              </>
            )}
          </NavLink>

          <NavDropdown
            id="data"
            label={t('nav.data')}
            items={DATA_ITEMS}
            openMenu={openMenu}
            onOpen={openNow}
            onCloseSoon={closeSoon}
            onSelect={() => setOpenMenu(null)}
          />

          <NavDropdown
            id="marketMap"
            label={t('nav.marketMap')}
            items={MARKET_MAP_ITEMS}
            openMenu={openMenu}
            onOpen={openNow}
            onCloseSoon={closeSoon}
            onSelect={() => setOpenMenu(null)}
          />

          <NavLink
            to="/watchlist"
            className={({ isActive }) => cn(topLinkCls, isActive ? topLinkActive : topLinkInactive)}
          >
            {({ isActive }) => (
              <>
                {t('nav.watchlist')}
                <ActiveIndicator show={isActive} />
              </>
            )}
          </NavLink>
        </div>
      )}

      {/* Mobile panel */}
      {showAppNav && mobileOpen && (
        <div className="md:hidden absolute left-0 right-0 top-full border-t border-b border-gray-100 bg-white px-4 py-1 shadow-[0_12px_32px_rgba(15,23,42,0.08)] z-40">
          <Link
            to="/dashboard"
            onClick={() => setMobileOpen(false)}
            className="block border-b border-gray-100 py-3 text-sm font-semibold text-[#0F172A]"
          >
            {t('nav.home')}
          </Link>
          <MobileAccordion
            label={t('nav.data')}
            items={DATA_ITEMS}
            expanded={mobileExpanded === 'data'}
            onToggle={() => setMobileExpanded((cur) => (cur === 'data' ? null : 'data'))}
            onSelect={() => setMobileOpen(false)}
          />
          <MobileAccordion
            label={t('nav.marketMap')}
            items={MARKET_MAP_ITEMS}
            expanded={mobileExpanded === 'marketMap'}
            onToggle={() => setMobileExpanded((cur) => (cur === 'marketMap' ? null : 'marketMap'))}
            onSelect={() => setMobileOpen(false)}
          />
          <Link
            to="/watchlist"
            onClick={() => setMobileOpen(false)}
            className="block py-3 text-sm font-semibold text-[#0F172A]"
          >
            {t('nav.watchlist')}
          </Link>
        </div>
      )}

      {/* Profile & Notifications */}
      <div className="flex items-center gap-2 sm:gap-4 flex-none">
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
