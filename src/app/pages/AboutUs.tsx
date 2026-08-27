import React from "react";
import { useTranslation } from "react-i18next";
import { Layout } from "../components/Layout";

// Decorative low-poly "map + growth" graphic — riffs on the same faceted-
// polygon technique as the BrandMark rhino (sage fills, navy/olive accents)
// instead of pulling in an external stock photo.
function AboutGraphic() {
  return (
    <div className="rounded-[10px] border border-gray-100 bg-[#F8F9FA] p-8 shadow-[0_4px_20px_rgba(0,0,0,0.02)]">
      <svg viewBox="0 0 320 260" className="w-full h-auto" aria-hidden="true">
        <polygon points="20,220 100,180 160,210 240,140 300,175 300,240 20,240" fill="#CBD1C2" />
        <polygon points="100,180 160,210 160,240 100,240" fill="#B7BEA8" />
        <polygon points="160,210 240,140 240,240 160,240" fill="#9BA588" />
        <polyline
          points="35,190 95,150 150,115 205,75 275,50"
          fill="none"
          stroke="#0F172A"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity="0.85"
        />
        <circle cx="35" cy="190" r="5" fill="#0F172A" />
        <circle cx="95" cy="150" r="5" fill="#0F172A" />
        <circle cx="150" cy="115" r="5" fill="#0F172A" />
        <circle cx="205" cy="75" r="5" fill="#0F172A" />
        <circle cx="275" cy="50" r="7" fill="#7C8967" />
      </svg>
    </div>
  );
}

export function AboutUs() {
  const { t } = useTranslation();
  const paragraphs = t("about.body", { returnObjects: true }) as unknown as string[];

  return (
    <Layout>
      <div className="mx-auto max-w-[1200px] px-4 sm:px-6 lg:px-8 py-12 sm:py-16">
        <div className="grid grid-cols-1 lg:grid-cols-[1.15fr_1fr] gap-12 lg:gap-16 items-center">
          <div>
            <h1
              className="text-3xl sm:text-4xl font-normal tracking-tight text-[#0F172A] mb-6"
              style={{ fontFamily: "'Playfair Display', serif" }}
            >
              {t("about.title")}
            </h1>
            <div className="space-y-5">
              {paragraphs.map((paragraph, i) => (
                <p key={i} className="text-sm sm:text-base leading-relaxed text-gray-500">
                  {paragraph}
                </p>
              ))}
            </div>
          </div>

          <AboutGraphic />
        </div>
      </div>
    </Layout>
  );
}
