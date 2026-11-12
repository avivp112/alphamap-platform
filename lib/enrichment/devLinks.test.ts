import { describe, it, expect } from "vitest";
import { devLinksFromText, pickDevLinks } from "./devLinks";

describe("organization links on the company's own site", () => {
  const footer = "© 2026 Acme. [GitHub](https://github.com/acme-ai) · [Hugging Face](https://huggingface.co/acme-ai/) · [X](https://x.com/acme)";
  it("takes the bare organization address of GitHub and Hugging Face", () => {
    expect(devLinksFromText(footer)).toEqual({ github: ["https://github.com/acme-ai"], huggingface: ["https://huggingface.co/acme-ai"] });
  });
  it("a repo or a model is not the organization; reserved paths and other hosts are ignored", () => {
    const t = "see https://github.com/facebook/react and https://huggingface.co/mistralai/Mistral-7B and https://github.com/features and https://huggingface.co/models and https://gitlab.com/acme";
    expect(devLinksFromText(t)).toEqual({ github: [], huggingface: [] });
  });
  it("one organization across the site, else none (a page that points at partners)", () => {
    const home = { url: "https://acme.ai", dev_links: devLinksFromText(footer) };
    const about = { url: "https://acme.ai/about", dev_links: devLinksFromText("https://github.com/acme-ai") };
    expect(pickDevLinks([home, about]).github).toEqual({ url: "https://github.com/acme-ai", page: "https://acme.ai" });
    const partners = { url: "https://acme.ai/partners", dev_links: devLinksFromText("https://github.com/other-org") };
    expect(pickDevLinks([home, partners]).github).toBeNull();
    expect(pickDevLinks([home, partners]).huggingface).not.toBeNull();
    expect(pickDevLinks([])).toEqual({ github: null, huggingface: null });
  });
});
