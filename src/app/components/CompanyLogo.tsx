import React, { useState, useEffect } from 'react';

// ── Domain extraction ──────────────────────────────────────────────────────────

export function extractDomain(website: string | null | undefined): string | null {
  if (!website) return null;

  let s = website.trim();
  s = s.replace(/^https?:\/\//i, '');
  s = s.replace(/^www\./i, '');
  s = s.split('/')[0].split('?')[0].split('#')[0];
  s = s.split(':')[0];
  s = s.replace(/\.+$/, '').trim().toLowerCase();

  if (!s || s === '#' || s === '-' || !s.includes('.')) return null;
  return s;
}

// ── Logo source chain (no auth required) ──────────────────────────────────────
// 0: Google S2 favicon at 64px — globe fallback detected by naturalWidth ≤ 16
// 1: Apple touch icon served directly from the company domain (180×180, high quality)
// 2: Standard favicon.ico served directly from the company domain
// 3+: show initials

function getSources(domain: string): string[] {
  return [
    `https://www.google.com/s2/favicons?domain=${domain}&sz=64`,
    `https://${domain}/apple-touch-icon.png`,
    `https://${domain}/favicon.ico`,
  ];
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
  const domain = extractDomain(website);
  const sources = domain ? getSources(domain) : [];

  // Index into sources[]; sources.length means "show initials"
  const [srcIdx, setSrcIdx] = useState<number>(() => (domain === null ? sources.length : 0));

  // Reset when domain changes (data loaded async, or different company rendered)
  useEffect(() => {
    setSrcIdx(domain === null ? (sources.length || 3) : 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [domain]);

  const { bg, text } = paletteFor(name);
  const initials = getInitials(name);
  const containerStyle: React.CSSProperties = { width: size, height: size, flexShrink: 0 };
  const base = `flex-none flex items-center justify-center overflow-hidden ${rounded} ${className}`;

  const advance = () => setSrcIdx(i => i + 1);

  // ── Logo image ─────────────────────────────────────────────────────────────
  if (domain && srcIdx < sources.length) {
    const src = sources[srcIdx];
    const isGoogle = srcIdx === 0;

    return (
      <div
        className={base}
        style={{ ...containerStyle, background: '#0d1f35', border: '1px solid #1a2a3f' }}
      >
        <img
          key={src}
          src={src}
          alt={`${name} logo`}
          draggable={false}
          loading="lazy"
          onLoad={isGoogle ? (e) => {
            // Google returns the generic globe at 16×16 for unknown domains.
            // Any real favicon is at least 32px when sz=64 is requested.
            const img = e.currentTarget;
            if (img.naturalWidth <= 16 || img.naturalHeight <= 16) advance();
          } : undefined}
          onError={advance}
          className="w-full h-full object-contain p-1"
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
