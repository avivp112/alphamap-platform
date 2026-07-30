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
import { Checkout } from "./pages/Checkout";
import { Profile } from "./pages/Profile";
import { Watchlist } from "./pages/Watchlist";
import { NotFound, RouteError } from "./pages/RouteFallback";

// Everything hangs off one pathless parent so a single ErrorBoundary covers
// every route. Without it, any render error — or any URL that matches nothing —
// drops the user on react-router's built-in developer error screen with no way
// back into the app.
//
// This is the in-app half of the refresh problem. The other half is server
// side: a hard refresh on /dashboard is a request for a file that does not
// exist, and never reaches React unless the host rewrites unknown paths to
// index.html. See the "rewrites" block in vercel.json.
export const router = createBrowserRouter([
  {
    element: <Outlet />,
    ErrorBoundary: RouteError,
    children: [
  { path: "/",           Component: LandingPage },
  { path: "/signup",     Component: SignUp },
  { path: "/login",      Component: Login },
  { path: "/dashboard",  Component: Dashboard },
  { path: "/markets",    Component: Dashboard },  // legacy alias
  { path: "/vcs",        Component: VCs },
  { path: "/startups",   Component: Startups },
  { path: "/deals",      Component: Deals },
  { path: "/stocks",     Component: Stocks },
  { path: "/public-market", Component: PublicMarket },
  { path: "/ipos",       Component: IPOs },
  { path: "/market-map", Component: MarketMap },
  { path: "/private-equity", Component: PrivateEquity },
  { path: "/pricing",    Component: Pricing },
  { path: "/checkout/:plan", Component: Checkout },
  { path: "/profile",    Component: Profile },
  { path: "/watchlist",  Component: Watchlist },

      // Must stay last. Anything unmatched lands here instead of throwing.
      { path: "*",       Component: NotFound },
    ],
  },
]);
