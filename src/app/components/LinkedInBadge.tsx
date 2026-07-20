import React from "react";
import { Linkedin } from "lucide-react";

// Small circular LinkedIn link shown next to a person's name (founders,
// startup leadership, PE-firm partners) when a profile URL is on file.
// Renders nothing when absent — never a placeholder. Shared between the
// Startups tearsheet and the Private Equity firm tearsheet so the chip
// stays visually identical everywhere.
export function LinkedInBadge({ url, name }: { url?: string | null; name: string }) {
  if (!url) return null;
  const href = url.startsWith("http") ? url : `https://${url}`;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      title={`${name} on LinkedIn`}
      aria-label={`${name} on LinkedIn`}
      className="flex items-center justify-center w-5 h-5 rounded-full bg-[#0A66C2]/10 text-[#0A66C2] hover:bg-[#0A66C2]/20 transition-colors flex-none"
    >
      <Linkedin className="w-3 h-3" />
    </a>
  );
}
