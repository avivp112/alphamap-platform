import React, { useState, useEffect } from 'react';

// ── Domain extraction ──────────────────────────────────────────────────────────
// Returns the bare root domain (e.g. "a16z.com") or null for missing/invalid.

export function extractDomain(website: string | null | undefined): string | null {
  if (!website) return null;

  let s = website.trim();

  // Strip protocol
  s = s.replace(/^https?:\/\//i, '');

  // Strip leading www. (any capitalisation)
  s = s.replace(/^www\./i, '');

  // Take only the host part (drop path, query, hash)
  s = s.split('/')[0].split('?')[0].split('#')[0];

  // Strip port
  s = s.split(':')[0];

  // Strip trailing dots / whitespace
  s = s.replace(/\.+$/, '').trim().toLowerCase();

  // Must be a non-empty string that contains at least one dot
  // and isn't a placeholder value
  if (!s || s === '#' || s === '-' || !s.includes('.')) return null;

  return s;
}

// ── Initials helper ────────────────────────────────────────────────────────────

function getInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

// ── Colour palette (dark-mode) ────────────────────────────────────────────────

const PALETTE = [
  { bg: '#0e4f5e', text: '#67e8f9' },
  { bg: '#3b1f72', text: '#c4b5fd' },
  { bg: '#064e33', text: '#6ee7b7' },
  { bg: '#5c3d0a', text: '#fcd34d' },
  { bg: '#5c0a2d', text: '#f9a8d4' },
  { bg: '#1e3a5f', text: '#93c5fd' },
  { bg: '#4a2020', text: '#fca5a5' },
  { bg: '#1a3a2a', text: '#86efac' },
];

function paletteFor(name: string): { bg: string; text: string } {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

// ── Component ──────────────────────────────────────────────────────────────────

export interface CompanyLogoProps {
  name: string;
  website?: string | null;
  size?: number;
  rounded?: string;
  className?: string;
}

export function CompanyLogo({
  name,
  website,
  size = 40,
  rounded = 'rounded-xl',
  className = '',
}: CompanyLogoProps) {
  // Derive domain synchronously — needed for lazy useState and the effect below
  const domain = extractDomain(website);

  // Lazy initialiser: only evaluated once on mount, avoids the stale-closure
  // problem where re-renders with a new `website` prop would not change state.
  const [showInitials, setShowInitials] = useState<boolean>(() => domain === null);

  // If the parent feeds us a valid website AFTER the first render (e.g. data
  // loaded asynchronously), reset so we attempt the Clearbit URL again.
  useEffect(() => {
    if (domain !== null) {
      setShowInitials(false);
    }
  }, [domain]);

  const { bg, text } = paletteFor(name);
  const initials = getInitials(name);

  const containerStyle: React.CSSProperties = { width: size, height: size, flexShrink: 0 };
  const base = `flex-none flex items-center justify-center overflow-hidden ${rounded} ${className}`;

  // ── Clearbit logo ──────────────────────────────────────────────────────────
  if (!showInitials && domain) {
    return (
      <div
        className={base}
        style={{ ...containerStyle, background: '#0d1f35', border: '1px solid #1a2a3f' }}
      >
        <img
          src={`https://logo.clearbit.com/${domain}`}
          alt={`${name} logo`}
          draggable={false}
          loading="lazy"
          onError={() => setShowInitials(true)}
          className="w-full h-full object-contain"
        />
      </div>
    );
  }

  // ── Initials fallback ──────────────────────────────────────────────────────
  return (
    <div
      className={`${base} font-black select-none`}
      style={{
        ...containerStyle,
        background: bg,
        color: text,
        fontSize: Math.round(size * 0.35),
        letterSpacing: '-0.01em',
      }}
    >
      {initials}
    </div>
  );
}
