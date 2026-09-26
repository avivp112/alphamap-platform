import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation, Link, NavLink } from 'react-router';
import { useTranslation } from 'react-i18next';
import {
  Bell, User, ChevronDown, UserCircle, LogOut, Menu, X,
  Rocket, CandlestickChart, Landmark, Vault, Handshake, Globe2, ClipboardCheck,
  CheckCheck, Loader2,
} from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import {
  supabase, fetchNotifications, fetchUnreadNotificationCount, markNotificationRead, markAllNotificationsRead,
  type Notification,
} from '../../lib/supabase';
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

// Minute/hour granularity (unlike Startups.tsx's own relativeTime, which
// only goes down to whole days) -- a notification feed's freshest items are
// often minutes old, and "Today" would flatten all of those together.
function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diffSec = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (diffSec < 60) return "Just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 30) return `${diffDay}d ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// ── Primary nav (Home / Data / Market Map / My Watchlist) ───────────────────

interface NavItem {
  labelKey: string;
  to: string | null;
  icon: React.ElementType;
  // Plain English, not routed through i18n — same call as the Quick
  // Questions dropdown's copy: a short one-liner doesn't carry enough
  // weight on its own to justify a translation key in every locale file.
  description: string;
  // Backdrop tint for the card's image block. One cohesive family — warm
  // sage/stone neutrals, the same green already used as a secondary brand
  // accent elsewhere (ContactUs, GlobalTechHubMap: #7C8967) — with light
  // shade variation per card rather than a different hue each, so the grid
  // reads as one set instead of a rainbow. Icon always sits on a small white
  // chip in the center, navy icon — mirrors a card-on-backdrop illustration
  // rather than a flat color block.
  accent: { bg: string };
}

const DATA_ITEMS: NavItem[] = [
  { labelKey: 'nav.privateMarket',  to: '/startups',       icon: Rocket,
    description: 'Startups, funding rounds, and cap tables in one place.',
    accent: { bg: 'linear-gradient(135deg, #EEF1E7, #DCE3D0)' } },
  { labelKey: 'nav.publicMarket',   to: '/public-market',  icon: CandlestickChart,
    description: 'Live comps, multiples, and sector benchmarks.',
    accent: { bg: 'linear-gradient(135deg, #F0EFE7, #E3DFCF)' } },
  { labelKey: 'nav.privateEquity',  to: '/private-equity', icon: Vault,
    description: 'PE fund profiles, portfolios, and deal activity.',
    accent: { bg: 'linear-gradient(135deg, #ECEFEB, #DBE1D6)' } },
  { labelKey: 'nav.ventureCapital', to: '/vcs',            icon: Landmark,
    description: 'VC firm profiles, check sizes, and investment focus.',
    accent: { bg: 'linear-gradient(135deg, #EFF0E9, #E0E5D6)' } },
];

// Valuations and Due Diligence has no `to` — not built yet. Rendered as an
// inert card with a "Soon" badge rather than omitted, so the menu's shape
// doesn't shift once it ships.
const MARKET_MAP_ITEMS: NavItem[] = [
  { labelKey: 'nav.marketMap', to: '/market-map', icon: Globe2,
    description: 'Visualize the global tech ecosystem by sector and geography.',
    accent: { bg: 'linear-gradient(135deg, #EEF1E7, #DCE3D0)' } },
  { labelKey: 'nav.deals',     to: '/deals',       icon: Handshake,
    description: 'Track recent funding rounds and M&A activity.',
    accent: { bg: 'linear-gradient(135deg, #F0EFE7, #E3DFCF)' } },
  { labelKey: 'nav.valuationsDueDiligence', to: null, icon: ClipboardCheck,
    description: 'Comparable analysis and diligence checklists.',
    accent: { bg: 'linear-gradient(135deg, #ECEFEB, #DBE1D6)' } },
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
          "absolute left-0 top-full mt-1.5 w-[420px] rounded-lg border border-gray-100 bg-white p-3 shadow-[0_12px_32px_rgba(15,23,42,0.10)] transition-all duration-150 ease-out z-40",
          open ? "opacity-100 translate-y-0 pointer-events-auto" : "opacity-0 -translate-y-1 pointer-events-none",
        )}
      >
        <div className="grid grid-cols-2 gap-2.5">
          {items.map(({ labelKey, to, icon: Icon, description, accent }) => {
            if (!to) {
              return (
                <div
                  key={labelKey}
                  className="relative flex flex-col rounded-lg border border-gray-100 cursor-default opacity-60"
                >
                  <span className="absolute top-2 right-2 text-[9px] font-bold uppercase tracking-wider text-gray-400 bg-white/90 border border-gray-100 rounded-full px-2 py-0.5 z-10">
                    {t('nav.soon')}
                  </span>
                  <div
                    className="flex items-center justify-center h-20 rounded-t-lg flex-none"
                    style={{ background: accent.bg }}
                  >
                    <div className="flex items-center justify-center w-11 h-11 rounded-lg bg-white shadow-sm">
                      <Icon className="h-5 w-5 text-[#0F172A]/50" />
                    </div>
                  </div>
                  <div className="p-3">
                    <p className="text-[15px] font-bold text-gray-500 leading-snug" style={{ fontFamily: "'Playfair Display', serif" }}>{t(labelKey)}</p>
                    <p className="text-[11px] text-gray-400 leading-relaxed mt-1">{description}</p>
                  </div>
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
                  "group flex flex-col rounded-lg border transition-all",
                  linkActive ? "border-[#0F172A]/15 bg-gray-50" : "border-gray-100 hover:border-gray-200 hover:shadow-[0_4px_16px_rgba(15,23,42,0.08)]",
                )}
              >
                <div
                  className="flex items-center justify-center h-20 rounded-t-lg flex-none"
                  style={{ background: accent.bg }}
                >
                  <div className="flex items-center justify-center w-11 h-11 rounded-lg bg-white shadow-sm transition-transform duration-200 group-hover:scale-105">
                    <Icon className="h-5 w-5 text-[#0F172A]" />
                  </div>
                </div>
                <div className="p-3">
                  <p className="text-[15px] font-bold text-[#0F172A] leading-snug" style={{ fontFamily: "'Playfair Display', serif" }}>{t(labelKey)}</p>
                  <p className="text-[11px] text-gray-500 leading-relaxed mt-1">{description}</p>
                </div>
              </NavLink>
            );
          })}
        </div>
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

  // Phase 10: notification bell state.
  const [notifOpen, setNotifOpen]         = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [notifLoading, setNotifLoading]   = useState(false);
  const [unreadCount, setUnreadCount]     = useState(0);
  const notifRef = useRef<HTMLDivElement>(null);

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

  // Same close-on-outside-click/Escape pattern as the account dropdown above.
  useEffect(() => {
    if (!notifOpen) return;
    function handleClick(e: MouseEvent) {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) setNotifOpen(false);
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setNotifOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [notifOpen]);

  // Phase 10: poll the unread count every 60s, gated by tab visibility (same
  // philosophy as the dwell tracking in Startups.tsx's TearsheetModal — a
  // backgrounded tab shouldn't keep burning requests). No Realtime channel:
  // this is the only place in the app that would use one, so a simple poll
  // matches the codebase's existing "simple beats clever" bias better than
  // introducing that infrastructure for a single feature.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    function poll() {
      if (document.visibilityState !== "visible") return;
      fetchUnreadNotificationCount().then((n) => { if (!cancelled) setUnreadCount(n); }).catch(() => {});
    }
    poll();
    const interval = setInterval(poll, 60_000);
    document.addEventListener("visibilitychange", poll);
    return () => {
      cancelled = true;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", poll);
    };
  }, [user]);

  // The item list itself is only fetched when the dropdown actually opens —
  // no point keeping 20 rows fresh in the background for a closed dropdown.
  useEffect(() => {
    if (!notifOpen) return;
    setNotifLoading(true);
    fetchNotifications()
      .then(setNotifications)
      .catch(() => setNotifications([]))
      .finally(() => setNotifLoading(false));
  }, [notifOpen]);

  async function handleNotificationClick(n: Notification) {
    if (!n.read_at) {
      setNotifications((prev) => prev.map((x) => (x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x)));
      setUnreadCount((c) => Math.max(0, c - 1));
      markNotificationRead(n.id).catch(() => {});
    }
    setNotifOpen(false);
    if (n.link) navigate(n.link);
  }

  async function handleMarkAllRead() {
    setNotifications((prev) => prev.map((x) => (x.read_at ? x : { ...x, read_at: new Date().toISOString() })));
    setUnreadCount(0);
    markAllNotificationsRead().catch(() => {});
  }

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
    <header className="sticky top-0 z-30 relative flex min-h-[72px] sm:min-h-16 w-full items-center justify-between border-b border-white native:border-gray-100 bg-white px-4 lg:px-6 native:pl-5 native:pr-4 pt-[env(safe-area-inset-top)] shadow-sm">
      {/* Logo (+ mobile nav trigger) */}
      <div className="flex items-center gap-1 native:gap-2 flex-none min-w-0">
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
            to="/my-area"
            className={({ isActive }) => cn(topLinkCls, isActive ? topLinkActive : topLinkInactive)}
          >
            {({ isActive }) => (
              <>
                {t('nav.myArea')}
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
            to="/my-area"
            onClick={() => setMobileOpen(false)}
            className="block py-3 text-sm font-semibold text-[#0F172A]"
          >
            {t('nav.myArea')}
          </Link>
        </div>
      )}

      {/* Profile & Notifications — the three items below (language, bell,
          avatar) share a uniform native:h-10 circular/pill treatment so
          they read as one consistent group in the app; unchanged on web.
          native:gap-3 (wider than the sm:gap-4 desktop default collapses
          to on a narrow phone) keeps them from crowding each other. */}
      <div className="flex items-center gap-2.5 sm:gap-4 native:gap-3 flex-none">
        {/* Available signed in or out — a visitor reading the marketing copy
            needs the switcher just as much as an account holder. */}
        <LanguageSelector />

        {loadingUser ? (
          // Brief loading flash while the session is checked — neutral, no
          // assumption either way about whether the visitor is signed in.
          <div className="h-9 w-9 rounded-full bg-gray-100 animate-pulse" />
        ) : user ? (
          <>
            <div className="relative" ref={notifRef}>
              <button
                onClick={() => setNotifOpen((o) => !o)}
                aria-expanded={notifOpen}
                aria-haspopup="menu"
                aria-label={t('header.notifications')}
                className="relative rounded-full p-2.5 text-gray-500 hover:bg-gray-100 hover:text-[#111827] transition-colors native:h-10 native:w-10 native:flex native:items-center native:justify-center"
              >
                {/* Phase 10: was a permanent decorative dot -- now only
                    renders when there's something real to show, and carries
                    the actual count instead of a bare dot. */}
                {unreadCount > 0 && (
                  <span className="absolute right-1 top-1 native:-right-0.5 native:-top-0.5 min-w-[16px] h-4 px-1 flex items-center justify-center rounded-full bg-[#F59E0B] ring-2 ring-white text-[9px] font-bold text-white leading-none">
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </span>
                )}
                <Bell className="h-5 w-5" />
              </button>

              {notifOpen && (
                <div
                  role="menu"
                  className="absolute right-0 top-[calc(100%+8px)] w-80 max-w-[calc(100vw-2rem)] rounded-lg border border-gray-100 bg-white shadow-[0_12px_32px_rgba(15,23,42,0.12)] overflow-hidden"
                >
                  <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-gray-100">
                    <span className="text-xs font-bold text-[#111827]">{t('header.notifications')}</span>
                    {unreadCount > 0 && (
                      <button
                        onClick={handleMarkAllRead}
                        className="flex items-center gap-1 text-[11px] font-semibold text-gray-500 hover:text-[#111827] transition-colors"
                      >
                        <CheckCheck className="h-3 w-3" /> {t('header.markAllRead')}
                      </button>
                    )}
                  </div>

                  <div className="max-h-[360px] overflow-y-auto">
                    {notifLoading ? (
                      <div className="flex items-center justify-center py-8">
                        <Loader2 className="h-4 w-4 animate-spin text-gray-300" />
                      </div>
                    ) : notifications.length === 0 ? (
                      <div className="flex flex-col items-center gap-2 py-8 text-center px-4">
                        <Bell className="h-6 w-6 text-gray-200" />
                        <p className="text-xs text-gray-400">{t('header.noNotifications')}</p>
                      </div>
                    ) : (
                      notifications.map((n) => (
                        <button
                          key={n.id}
                          role="menuitem"
                          onClick={() => handleNotificationClick(n)}
                          className={cn(
                            "w-full text-left px-3.5 py-3 border-b border-gray-50 last:border-0 hover:bg-gray-50 transition-colors flex items-start gap-2.5",
                            !n.read_at && "bg-amber-50/40",
                          )}
                        >
                          <span
                            className={cn(
                              "mt-1.5 h-1.5 w-1.5 rounded-full flex-none",
                              n.read_at ? "bg-transparent" : "bg-[#F59E0B]",
                            )}
                          />
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-bold text-[#111827] truncate">{n.title}</p>
                            <p className="text-[11px] text-gray-500 leading-snug line-clamp-2 mt-0.5">{n.body}</p>
                            <p className="text-[10px] text-gray-400 mt-1">{timeAgo(n.created_at)}</p>
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
            <div className="hidden sm:block native:!hidden h-8 w-px bg-gray-200 mx-1" />

            <div className="relative" ref={menuRef}>
              <button
                onClick={() => setMenuOpen((o) => !o)}
                aria-expanded={menuOpen}
                aria-haspopup="menu"
                aria-label={t('header.accountMenu')}
                className="flex items-center gap-2 rounded-lg native:rounded-full border border-gray-200 p-1 sm:pr-2.5 native:h-10 native:w-10 native:p-0 native:justify-center hover:bg-gray-50 transition-colors"
              >
                {/* p-1 is uniform on every side on its own — sm:pr-2.5 only
                    adds the extra right-hand room the name+chevron need once
                    they're actually visible (sm: and up). Unconditional
                    pr-2.5 left the circle looking off-center on mobile,
                    where the name/chevron are hidden and that padding had
                    nothing to balance against. */}
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gray-100 flex-none">
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
                  className="absolute right-0 top-[calc(100%+8px)] w-56 rounded-lg border border-gray-100 bg-white py-1.5 shadow-[0_12px_32px_rgba(15,23,42,0.12)]"
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
              className="rounded-lg px-3.5 py-2 text-sm font-semibold text-[#111827] hover:bg-gray-50 transition-colors"
            >
              {t('header.logIn')}
            </Link>
            <Link
              to="/signup"
              className="rounded-lg bg-[#0F172A] px-4 py-2 text-sm font-semibold text-white hover:bg-gray-900 transition-colors"
            >
              {t('header.signUp')}
            </Link>
          </div>
        )}
      </div>
    </header>
  );
}
