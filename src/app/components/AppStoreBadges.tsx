import { useTranslation } from "react-i18next";
import { FaApple, FaGooglePlay } from "react-icons/fa";

// Store badges are web-only — inside the packaged native app there is
// nothing to "download", so callers should wrap this in `native:hidden`
// (see theme.css's `native:` variant) rather than this component doing it
// itself, keeping it a plain, context-free building block.

interface AppStoreBadgesProps {
  /** "onDark" for the landing page's black footer section, "onLight" for the white auth pages. */
  variant: "onDark" | "onLight";
  className?: string;
}

function Badge({
  icon, line1, line2, variant,
}: {
  icon: React.ReactNode;
  line1: string;
  line2: string;
  variant: "onDark" | "onLight";
}) {
  const variantCls =
    variant === "onDark"
      ? "border border-white/15 bg-white/5 hover:bg-white/10 text-white"
      : "border border-transparent bg-[#0F172A] hover:bg-[#1e293b] text-white";
  return (
    // href is a placeholder until the real App Store / Play Store listings exist.
    <a
      href="#"
      className={`flex items-center gap-2.5 rounded-lg px-4 py-2 transition-colors ${variantCls}`}
    >
      <span className="flex-none text-2xl leading-none">{icon}</span>
      <span className="flex flex-col leading-tight text-left">
        <span className="text-[10px] font-medium opacity-80">{line1}</span>
        <span className="text-sm font-semibold -mt-0.5">{line2}</span>
      </span>
    </a>
  );
}

export function AppStoreBadges({ variant, className = "" }: AppStoreBadgesProps) {
  const { t } = useTranslation();
  return (
    <div className={`flex flex-wrap items-center gap-3 ${className}`}>
      <Badge icon={<FaApple />} line1={t("common.downloadOnThe")} line2={t("common.appStore")} variant={variant} />
      <Badge icon={<FaGooglePlay />} line1={t("common.getItOn")} line2={t("common.googlePlay")} variant={variant} />
    </div>
  );
}
