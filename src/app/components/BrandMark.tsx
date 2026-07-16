import React from "react";

/**
 * The AlphaMap logo: a low-poly rhino head, white on the brand's dark navy,
 * in a rounded square badge. Shared by TopNav, LandingPage, SignUp, and Login
 * so the mark stays in sync everywhere it appears.
 */
export function BrandMark({ size = 32 }: { size?: number }) {
  return (
    <div
      className="flex items-center justify-center rounded-lg bg-[#0F172A] flex-none"
      style={{ width: size, height: size }}
    >
      <svg
        viewBox="0 0 100 100"
        fill="#FFFFFF"
        stroke="#0F172A"
        strokeWidth="2.2"
        strokeLinejoin="round"
        style={{ width: size * 0.56, height: size * 0.56 }}
      >
        {/* ear */}
        <polygon points="74,2 58,20 90,16" />
        {/* head + neck */}
        <polygon points="90,16 97,45 94,92 36,96 34,66 38,36 58,20" />
        {/* secondary horn */}
        <polygon points="24,26 46,29 40,35" />
        {/* main horn */}
        <polygon points="40,36 34,58 0,46" />
      </svg>
    </div>
  );
}
