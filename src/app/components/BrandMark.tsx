import React from "react";

// Sage green from the reference swatch — the rhino's fill color now that
// it's no longer sitting on the dark navy badge.
const RHINO_FILL = "#CBD1C2";

/**
 * The AlphaMap logo: a low-poly rhino head, sage green, rendered on its own
 * (no background badge). Shared by TopNav, LandingPage, SignUp, and Login so
 * the mark stays in sync everywhere it appears.
 *
 * The facet geometry below is traced directly from the source artwork
 * (public/38baef00-3ec1-4367-ac9d-b1d2ca8de20a.png) — each <polygon> is one
 * of that image's low-poly facets, extracted via a luminance threshold +
 * contour trace, then simplified. Not hand-drawn, so it matches exactly.
 */
export function BrandMark({ size = 32 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 100 81.4"
      fill={RHINO_FILL}
      className="flex-none"
      style={{ width: size * 1.15, height: size * 1.15 * (81.4 / 100) }}
    >
      <polygon points="32.52,22.91 29.04,12.48 35.38,0 40.9,11.25 38.85,17.38" />
      <polygon points="51.33,18.82 44.17,14.93 57.46,4.09 56.03,15.34" />
      <polygon points="0.61,51.13 0,11.25 15.75,4.91 28.02,9 26.99,13.29 30.67,24.75" />
      <polygon points="64.83,81.4 43.76,74.65 58.08,54.61 58.08,52.97 54.19,46.22 44.99,44.38 33.54,25.16 40.49,18.61 41.51,15.95 50.31,21.07 58.08,38.65 62.58,45.2 72.8,47.65 71.57,58.29 82.21,64.83 82.21,70.97 77.1,78.13 68.51,73.22 63.6,73.22 72.8,78.33" />
      <polygon points="82.82,62.17 73.62,57.06 74.85,46.84 90.39,34.97 100,18 96.52,46.02" />
      <polygon points="41.51,73.63 30.27,65.24 22.49,47.65 24.54,32.52 31.7,26.18 43.35,45.61 56.03,53.79" />
      <polygon points="73.01,45.4 64.01,43.77 60.53,38.25 74.23,30.68 74.85,37.84" />
      <polygon points="12.47,79.35 0.82,53.38 22.29,34.77 20.45,47.65 27.81,66.06" />
    </svg>
  );
}

/**
 * The "AlphaMap" logotype. `className` controls size/color/visibility per
 * call site (e.g. text-xl vs text-2xl, dark text on light vs white on the
 * dark brand panel) — the font itself lives here so it only changes once.
 */
export function BrandWordmark({ className = "" }: { className?: string }) {
  return (
    <span className={className} style={{ fontFamily: "'Fraunces', serif", fontWeight: 600 }}>
      AlphaMap
    </span>
  );
}
