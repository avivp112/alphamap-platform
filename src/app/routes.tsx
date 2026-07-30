import { createBrowserRouter, Outlet } from "react-router";
import { LandingPage } from "./pages/LandingPage";
import { Dashboard } from "./pages/Dashboard";
import { Startups } from "./pages/Startups";
import { Stocks } from "./pages/Stocks";
import { IPOs } from "./pages/IPOs";
import { VCs } from "./pages/VCs";
import { Deals } from "./pages/Deals";
import { SignUp } from "./pages/SignUp";
import { Login } from "./pages/Login";
import { MarketMap } from "./pages/MarketMap";
import { PrivateEquity } from "./pages/PrivateEquity";
import { PublicMarket } from "./pages/PublicMarket";
import { Pricing } from "./pages/Pricing";
import { AboutUs } from "./pages/AboutUs";
import { ContactUs } from "./pages/ContactUs";
import { TermsOfUse } from "./pages/TermsOfUse";
import { PrivacyPolicy } from "./pages/PrivacyPolicy";
import { Checkout } from "./pages/Checkout";
import { Profile } from "./pages/Profile";
import { Watchlist } from "./pages/Watchlist";
import { NotFound, RouteError } from "./pages/RouteFallback";
import { requireAuth } from "./routeGuards";

// Everything hangs off one pathless parent so a single ErrorBoundary covers
// every route. Without it, any render error — or any URL that matches nothing —
// drops the user on react-router's built-in developer error screen with no way
// back into the app.
//
// This is the in-app half of the refresh problem. The other half is server
// side: a hard refresh on /dashboard is a request for a file that does not
// exist, and never reaches React unless the host rewrites unknown paths to
// index.html. See the "rewrites" block in vercel.json.
//
// Every page that requires a signed-in user carries a requireAuth loader.
// Without it, these routes rendered unconditionally: a signed-out visitor
// who reached /pricing (itself a legitimate destination) could open the
// Sidebar menu and click straight into the full app. /checkout/:plan is
// deliberately excluded — it already redirects an anonymous visitor through
// /signup?next=... on its own.
export const router = createBrowserRouter([
  {
    element: <Outlet />,
    ErrorBoundary: RouteError,
    children: [
  { path: "/",           Component: LandingPage },
  { path: "/signup",     Component: SignUp },
  { path: "/login",      Component: Login },
  { path: "/dashboard",  Component: Dashboard, loader: requireAuth },
  { path: "/markets",    Component: Dashboard, loader: requireAuth },  // legacy alias
  { path: "/vcs",        Component: VCs, loader: requireAuth },
  { path: "/startups",   Component: Startups, loader: requireAuth },
  { path: "/deals",      Component: Deals, loader: requireAuth },
  { path: "/stocks",     Component: Stocks, loader: requireAuth },
  { path: "/public-market", Component: PublicMarket, loader: requireAuth },
  { path: "/ipos",       Component: IPOs, loader: requireAuth },
  { path: "/market-map", Component: MarketMap, loader: requireAuth },
  { path: "/private-equity", Component: PrivateEquity, loader: requireAuth },
  { path: "/pricing",    Component: Pricing },
  { path: "/about",      Component: AboutUs },
  { path: "/contact",    Component: ContactUs },
  { path: "/terms",      Component: TermsOfUse },
  { path: "/privacy",    Component: PrivacyPolicy },
  { path: "/checkout/:plan", Component: Checkout },
  { path: "/profile",    Component: Profile, loader: requireAuth },
  { path: "/watchlist",  Component: Watchlist, loader: requireAuth },

      // Must stay last. Anything unmatched lands here instead of throwing.
      { path: "*",       Component: NotFound },
    ],
  },
]);
