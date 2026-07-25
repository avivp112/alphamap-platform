import React, { useEffect, useState } from 'react';

// FMP serves stock logos from this CDN keyed by ticker, publicly, with no API
// key required — https://images.financialmodelingprep.com/symbol/{TICKER}.png
export interface TickerLogoProps {
  ticker: string;
  className?: string;
}

export function TickerLogo({ ticker, className = '' }: TickerLogoProps) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [ticker]);

  return (
    <div
      className={`flex flex-none items-center justify-center overflow-hidden bg-[#0F172A] text-white font-black ${className}`}
    >
      {failed ? (
        ticker.slice(0, 4)
      ) : (
        <img
          key={ticker}
          src={`https://images.financialmodelingprep.com/symbol/${ticker}.png`}
          alt={`${ticker} logo`}
          draggable={false}
          loading="lazy"
          onError={() => setFailed(true)}
          className="w-full h-full object-contain p-1"
        />
      )}
    </div>
  );
}
