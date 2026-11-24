import { describe, it, expect } from "vitest";
import { identityOverlap, englishShare } from "./identityMismatch.ts";

const pathologySite = "Aperio digital pathology scanners let pathologists view slides on screen instead of a microscope. The Aperio GT Elite scanner digitises glass slides in clinical laboratories. Image management software gives laboratory professionals and IT teams access to the resulting images, and image analysis helps with cancer diagnosis. Aperio products are sold to hospitals, reference laboratories and research institutions worldwide. Pathologists review cases remotely and share images with colleagues for consultation and education. Our laboratory customers scan thousands of slides every day and store the images securely for later review and study.";
describe("identity: the search profile against the company's own pages (owner, 2026-11-24: Aperio)", () => {
  it("a profile of another company with the same name does not overlap the site", () => {
    const r = identityOverlap("Software platform for industrial operational data quality that automatically validates operational data for energy and utility customers across complex industrial operations.", pathologySite);
    expect(r?.mismatch).toBe(true);
  });
  it("a profile of the site's own company overlaps it", () => {
    const r = identityOverlap("Aperio sells digital pathology scanners and image management software to pathologists and laboratory professionals who review slides and images.", pathologySite);
    expect(r?.mismatch).toBe(false);
  });
  it("too little text to tell is no verdict", () => {
    expect(identityOverlap("A thing.", pathologySite)).toBeNull();
    expect(identityOverlap("Software platform for industrial operational data quality that validates operational data.", "short site text")).toBeNull();
  });
});

describe("english share of a text", () => {
  it("an English page has a high share, a German one a low one", () => {
    expect(englishShare("We are the leading provider of tools for the teams that you work with and our customers can use all of them in the cloud, on any device, at any time of the day or the night, for every project that they have.")).toBeGreaterThan(0.25);
    expect(englishShare("Wir sind der führende Anbieter von Kassensystemen für die Gastronomie und bieten unseren Kunden eine moderne Lösung mit allen Funktionen für den täglichen Betrieb im Restaurant, im Café und in der Bar jeden Tag.")).toBeLessThan(0.1);
  });
});
