import React, { useEffect, useRef, useState } from 'react';
import { NavLink, Link, useLocation } from 'react-router';
import { useTranslation } from 'react-i18next';
import {
  ChevronDown, Menu, X,
  Rocket, CandlestickChart, Landmark, Vault, Handshake, Globe2, ClipboardCheck,
} from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

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
  "relative px-4 py-2.5 text-sm font-medium transition-colors rounded-lg";
const topLinkActive = "text-[#0F172A] font-semibold";
const topLinkInactive = "text-gray-500 hover:text-[#0F172A] hover:bg-gray-50";

function ActiveIndicator({ show }: { show: boolean }) {
  return (
    <span
      className={cn(
        "pointer-events-none absolute left-4 right-4 bottom-1 h-[2px] rounded-full bg-[#0F172A] transition-opacity duration-150",
        show ? "opacity-100" : "opacity-0",
      )}
    />
  );
}

// Shared dropdown: opens on hover (with a short close delay so moving the
// cursor from the trigger into the panel doesn't close it) and toggles on
// click, so it works the same for a mouse, a touch tap, or a keyboard.
function NavDropdown({
  id, label, items, openMenu, onOpen, onCloseSoon, onToggle, onSelect,
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

export function NavBar() {
  const { t } = useTranslation();
  const location = useLocation();
  const [openMenu, setOpenMenu] = useState<MenuId | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [mobileExpanded, setMobileExpanded] = useState<MenuId | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const navRef = useRef<HTMLElement>(null);

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
      if (navRef.current && !navRef.current.contains(e.target as Node)) setOpenMenu(null);
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

  return (
    <nav ref={navRef} className="sticky top-16 z-20 w-full border-b border-gray-100 bg-white">
      <div className="mx-auto max-w-[1280px] px-4 lg:px-6">
        {/* Desktop */}
        <div className="hidden md:flex items-center gap-1 h-12">
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

        {/* Mobile trigger */}
        <div className="flex md:hidden items-center h-12">
          <button
            type="button"
            onClick={() => setMobileOpen((o) => !o)}
            aria-expanded={mobileOpen}
            aria-label={t('nav.toggleNavigation')}
            className="flex items-center p-2 -ml-2 text-[#0F172A]"
          >
            {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {/* Mobile panel */}
      {mobileOpen && (
        <div className="md:hidden border-t border-gray-100 bg-white px-4 py-1">
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
    </nav>
  );
}
