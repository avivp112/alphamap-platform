import React, { useState } from 'react';

// ── Domain extraction ──────────────────────────────────────────────────────────

export function extractDomain(website: string | null | undefined): string | null {
  if (!website) return null;
  const d = website
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split('/')[0]
    .split('?')[0]
    .replace(/\.$/, '');
  // Guard against placeholder values like "#", "-", or bare strings with no TLD
  if (!d || d === '#' || d === '-' || !d.includes('.')) return null;
  return d;
}

// ── Initials fallback palette (dark-mode) ─────────────────────────────────────

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

function getInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

// ── Component ──────────────────────────────────────────────────────────────────

type LogoState = 'clearbit' | 'google' | 'initials';

export interface CompanyLogoProps {
  /** Company or fund name — used for initials fallback and colour derivation */
  name: string;
  /** Raw website URL — domain is extracted automatically */
  website?: string | null;
  /** Pixel size of the square container (default 40) */
  size?: number;
  /** Tailwind border-radius class applied to the container (default 'rounded-xl') */
  rounded?: string;
  /** Extra classes forwarded to the container */
  className?: string;
}

export function CompanyLogo({
  name,
  website,
  size = 40,
  rounded = 'rounded-xl',
  className = '',
}: CompanyLogoProps) {
  const domain = extractDomain(website);

  const [state, setState] = useState<LogoState>(domain ? 'clearbit' : 'initials');

  const clearbitUrl = domain ? `https://logo.clearbit.com/${domain}` : null;
  const googleUrl   = domain
    ? `https://t2.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=http://${domain}&size=128`
    : null;

  const { bg, text } = paletteFor(name);
  const initials = getInitials(name);

  const containerStyle: React.CSSProperties = { width: size, height: size, flexShrink: 0 };

  // Shared container class
  const base = `flex-none flex items-center justify-center overflow-hidden ${rounded} ${className}`;

  // ── Tier 1: Clearbit Logo API ──────────────────────────────────────────────
  if (state === 'clearbit' && clearbitUrl) {
    return (
      <div
        className={base}
        style={{ ...containerStyle, background: '#0d1f35', border: '1px solid #1a2a3f' }}
      >
        <img
          src={clearbitUrl}
          alt={`${name} logo`}
          draggable={false}
          loading="lazy"
          onError={() => setState('google')}
          style={{ width: '76%', height: '76%', objectFit: 'contain', display: 'block' }}
        />
      </div>
    );
  }

  // ── Tier 2: Google Favicon API ────────────────────────────────────────────
  if (state === 'google' && googleUrl) {
    return (
      <div
        className={base}
        style={{ ...containerStyle, background: '#0d1f35', border: '1px solid #1a2a3f' }}
      >
        <img
          src={googleUrl}
          alt={`${name} logo`}
          draggable={false}
          loading="lazy"
          onError={() => setState('initials')}
          style={{ width: '60%', height: '60%', objectFit: 'contain', display: 'block' }}
        />
      </div>
    );
  }

  // ── Tier 3: Coloured initials circle ─────────────────────────────────────
  return (
    <div
      className={`${base} font-black select-none`}
      style={{
        ...containerStyle,
        background: bg,
        color: text,
        fontSize: Math.round(size * 0.35),
        letterSpacing: '-0.01em',
        border: '1px solid transparent',
      }}
    >
      {initials}
    </div>
  );
}
