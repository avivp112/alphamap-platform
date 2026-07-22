import { createBrowserRouter } from "react-router";
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
import { Pricing } from "./pages/Pricing";
import { Checkout } from "./pages/Checkout";

export const router = createBrowserRouter([
  { path: "/",           Component: LandingPage },
  { path: "/signup",     Component: SignUp },
  { path: "/login",      Component: Login },
  { path: "/dashboard",  Component: Dashboard },
  { path: "/markets",    Component: Dashboard },  // legacy alias
  { path: "/vcs",        Component: VCs },
  { path: "/startups",   Component: Startups },
  { path: "/deals",      Component: Deals },
  { path: "/stocks",     Component: Stocks },
  { path: "/ipos",       Component: IPOs },
  { path: "/market-map", Component: MarketMap },
  { path: "/private-equity", Component: PrivateEquity },
  { path: "/pricing",    Component: Pricing },
  { path: "/checkout/:plan", Component: Checkout },
]);
