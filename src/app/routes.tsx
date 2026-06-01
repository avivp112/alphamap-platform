import { createBrowserRouter } from "react-router";
import { LandingPage } from "./pages/LandingPage";
import { Dashboard } from "./pages/Dashboard";
import { Startups } from "./pages/Startups";
import { Stocks } from "./pages/Stocks";
import { IPOs } from "./pages/IPOs";

export const router = createBrowserRouter([
  { path: "/",          Component: LandingPage },
  { path: "/dashboard", Component: Dashboard },
  { path: "/markets",   Component: Dashboard },  // legacy alias
  { path: "/vcs",       Component: Dashboard },
  { path: "/startups",  Component: Startups },
  { path: "/stocks",    Component: Stocks },
  { path: "/ipos",      Component: IPOs },
]);
