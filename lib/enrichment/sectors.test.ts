import { describe, it, expect } from "vitest";
import { reconcileSector } from "./sectors";

const parentOf: Record<string, string> = {
  "DevOps / CI-CD": "SaaS & Dev Tools", "Developer Tools": "SaaS & Dev Tools", "SaaS / General": "SaaS & Dev Tools",
  "DeepTech / General": "DeepTech", "Space Tech": "DeepTech", Robotics: "DeepTech",
};

describe("a sector the taxonomy agrees with itself about (owner, 2026-11-08, review 6)", () => {
  it("EngFlow: DeepTech › DevOps / CI-CD becomes SaaS & Dev Tools › DevOps / CI-CD", () => {
    const r = reconcileSector({ sector_name: "DeepTech", sub_sector_name: "DevOps / CI-CD" }, parentOf);
    expect(r.fields).toMatchObject({ sector_name: "SaaS & Dev Tools", sub_sector_name: "DevOps / CI-CD" });
    expect(r.changes).toEqual(["sector DeepTech → SaaS & Dev Tools"]);
  });
  it("DeepTech › DeepTech / General gives way to a specific sub-sector the company also names", () => {
    const r = reconcileSector({ sector_name: "DeepTech", sub_sector_name: "DeepTech / General", sub_sector_names: ["Space Tech"] }, parentOf);
    expect(r.fields).toMatchObject({ sector_name: "DeepTech", sub_sector_name: "Space Tech", sub_sector_names: [] });
  });
  it("DeepTech with no sub-sector takes a specific one from another parent, DevOps for EngFlow", () => {
    const r = reconcileSector({ sector_name: "DeepTech", sub_sector_names: ["Developer Tools"] }, parentOf);
    expect(r.fields).toMatchObject({ sector_name: "SaaS & Dev Tools", sub_sector_name: "Developer Tools" });
  });
  it("nothing specific: DeepTech / General stays (the fallback)", () => {
    const r = reconcileSector({ sector_name: "DeepTech", sub_sector_name: "DeepTech / General" }, parentOf);
    expect(r.fields).toMatchObject({ sector_name: "DeepTech", sub_sector_name: "DeepTech / General" });
    expect(r.changes).toEqual([]);
  });
  it("a coherent pair is untouched; no taxonomy, no change", () => {
    expect(reconcileSector({ sector_name: "SaaS & Dev Tools", sub_sector_name: "Developer Tools" }, parentOf).changes).toEqual([]);
    expect(reconcileSector({ sector_name: "DeepTech", sub_sector_name: "DevOps / CI-CD" }, undefined).changes).toEqual([]);
  });
});

describe("a sub-sector that is the name of a sector (review 7, x67.40)", () => {
  const parents = ["Health & Life Sciences", "Cybersecurity", "SaaS & Dev Tools", "DeepTech"];
  it("Health & Life Sciences › Cybersecurity is Cybersecurity, with no sub-sector to guess", () => {
    const r = reconcileSector({ sector_name: "Health & Life Sciences", sub_sector_name: "Cybersecurity" }, parentOf, parents);
    expect(r.fields).toMatchObject({ sector_name: "Cybersecurity", sub_sector_name: undefined });
    expect(r.changes[0]).toMatch(/Health & Life Sciences → Cybersecurity/);
  });
  it("the same sector named twice just loses the repeat", () => {
    expect(reconcileSector({ sector_name: "Cybersecurity", sub_sector_name: "Cybersecurity" }, parentOf, parents).fields).toMatchObject({ sector_name: "Cybersecurity", sub_sector_name: undefined });
  });
});


import { subSectorUnsupported } from "./sectors";
describe("Computer Vision is for images and video (review 8, Verbit)", () => {
  it("a voice AI company is not Computer Vision; a pathology imaging company is", () => {
    expect(subSectorUnsupported("Computer Vision", "Verbit sells a verbal intelligence and voice AI platform that combines speech recognition with human transcribers.")).toBe(true);
    expect(subSectorUnsupported("Computer Vision", "Ibex sells AI-powered digital pathology that analyzes images of tissue samples.")).toBe(false);
    expect(subSectorUnsupported("Payments", "anything")).toBe(false);
  });
});
