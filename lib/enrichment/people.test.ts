import { describe, it, expect } from "vitest";
import { foundersFromText, personMentionedIn, cleanPeople, isLeadershipRole, founderNamesNotExtracted } from "./people";
import { parseLinkedInPersonResult } from "./linkedin";

describe("foundersFromText — 'founded by' sentences about THIS company", () => {
  it("an organisation is never a founder (field review run 2: Insightec)", () => {
    expect(foundersFromText("Insightec was founded in 1999 by GE Healthcare and Elbit Medical Imaging.", "Insightec")).toEqual([]);
  });
  it("reads the founders from a subject sentence (real GoCo / Glints quotes)", () => {
    expect(foundersFromText("GoCo.io, Inc. was founded in 2015 by Jason J. Wang, Michael Gugel, and Nir Leibovich.", "GoCo").map((f) => f.name))
      .toEqual(["Jason J. Wang", "Michael Gugel", "Nir Leibovich"]);
    expect(foundersFromText("Glints was founded in August 2013 by Oswald Yeo, Looi Qin En, and Seah Ying Cong.", "Glints").map((f) => f.name))
      .toEqual(["Oswald Yeo", "Looi Qin En", "Seah Ying Cong"]);
  });
  it("marks co-founders and strips parentheticals", () => {
    expect(foundersFromText("HighLevel was co-founded by Shaun Clark (CEO), Varun Vairavan, and Robin Alex in 2018.", "HighLevel"))
      .toEqual([{ name: "Shaun Clark", title: "Co-founder" }, { name: "Varun Vairavan", title: "Co-founder" }, { name: "Robin Alex", title: "Co-founder" }]);
  });
  it("never takes another company's founders from a sentence that merely names ours", () => {
    expect(foundersFromText("Rival Acme, founded by John Doe, competes with Gladia.", "Gladia")).toEqual([]);
    expect(foundersFromText("Unlike Gladia, Speechmatics was founded by Tony Robinson.", "Gladia")).toEqual([]);
  });
  it("accepts 'It was founded by' only on a page about the company", () => {
    const text = "It was founded in 2022 by Jean-Louis Queguiner and Jonathan Soto.";
    expect(foundersFromText(text, "Gladia", { url: "https://techcrunch.com/2024/10/15/gladia-series-a" })).toHaveLength(2);
    expect(foundersFromText(text, "Gladia", { url: "https://example.com/speech-apis" })).toEqual([]);
  });
  it("ignores non-person names", () => {
    expect(foundersFromText("Acme was founded by former Google engineers.", "Acme")).toEqual([]);
  });
});

describe("LinkedIn founder discovery — the company must be what they founded (GoHighLevel got agency owners)", () => {
  const r = (title: string, content: string) => ({ url: "https://www.linkedin.com/in/x", title, content });
  it("rejects 'Founder at <their agency> | GoHighLevel expert' and 'Founder of Cumulus' who mentions Global Relay", () => {
    expect(parseLinkedInPersonResult(r("Sophie Arambula - Founder at Bloom Agency | GoHighLevel Expert | LinkedIn", ""), "GoHighLevel")?.isFounder).toBe(false);
    expect(parseLinkedInPersonResult(r("Michael Schwert - Founder of Cumulus Inc, The source for ... | LinkedIn", "Experience: Global Relay"), "Global Relay")?.isFounder).toBe(false);
  });
  it("accepts 'Co-founder & CEO at Gladia' and 'Gladia co-founder'", () => {
    expect(parseLinkedInPersonResult(r("Jean-Louis Quéguiner - Gladia | LinkedIn", "Co-founder & CEO at Gladia."), "Gladia")?.isFounder).toBe(true);
    expect(parseLinkedInPersonResult(r("Jonathan Soto – Co-founder & CTO – Gladia | LinkedIn", ""), "Gladia")?.isFounder).toBe(true);
    expect(parseLinkedInPersonResult(r("Ann Lee - Gladia co-founder | LinkedIn", ""), "Gladia")?.isFounder).toBe(true);
  });
});

describe("personMentionedIn / cleanPeople", () => {
  it("finds a name with accents or a middle initial", () => {
    expect(personMentionedIn("Jean-Louis Quéguiner", "CEO Jean-Louis Queguiner said")).toBe(true);
    expect(personMentionedIn("Jason Wang", "founded by Jason J. Wang and")).toBe(true);
    expect(personMentionedIn("Sophie Arambula", "Gladia raised $16M")).toBe(false);
  });
  it("drops single-name entries and duplicates", () => {
    expect(cleanPeople([{ name: "Shannon" }, { name: "Alex Viall" }, { name: "Viall" }, { name: "alex viall" }, { name: "Spencer Gareiss" }]).map((p) => p.name))
      .toEqual(["Alex Viall", "Spencer Gareiss"]);
  });
});

describe("isLeadershipRole — a leader needs a real role (BETA, 2026-10-26)", () => {
  it("drops a placeholder or a non-leadership role", () => {
    expect(isLeadershipRole("Employee (Department/Title not specified)")).toBe(false);
    expect(isLeadershipRole("")).toBe(false);
    expect(isLeadershipRole(null)).toBe(false);
    expect(isLeadershipRole("Software Engineer")).toBe(false);
  });
  it("a tech / team lead is not a leader (Orq, pilot dry run 2026-11-08)", () => {
    for (const r of ["Tech Lead", "Technical Lead", "Team Lead", "Product Lead"]) expect(isLeadershipRole(r)).toBe(false);
    expect(isLeadershipRole("Tech Lead and CTO")).toBe(true);
  });
  it("keeps executives", () => {
    for (const r of ["CEO (Co-Founder)", "Chief Technology Officer", "VP Engineering", "SVP Sales", "EVP Operations", "CISO", "President", "Managing Director", "General Manager, EMEA", "Co-founder"]) {
      expect(isLeadershipRole(r)).toBe(true);
    }
  });
  it("the list is closed: Head of, Director, Manager, Lead, Chief of Staff are not leaders (owner, 2026-11-09)", () => {
    for (const r of ["Head of Product", "Director of Engineering", "Engineering Manager", "Lead Designer", "Chief of Staff", "Partner", "Advisor", "Board member"]) {
      expect(isLeadershipRole(r)).toBe(false);
    }
  });
});

describe("founders read from 'founded by' snippets (eval run of 2026-10-29)", () => {
  it("a place after the names is not a founder — Apex's 'Los Angeles'", () => {
    expect(foundersFromText("Apex was founded by Ian Cinnamon and Max Benassi, Los Angeles, Calif.", "Apex").map((f) => f.name)).toEqual(["Ian Cinnamon", "Max Benassi"]);
  });
  it("a role at another company in front of the name is dropped — 'OpenAI CTO Mira Murati' is Mira Murati", () => {
    expect(foundersFromText("Thinking Machines Lab was founded by former OpenAI CTO Mira Murati, San Francisco.", "Thinking Machines Lab").map((f) => f.name)).toEqual(["Mira Murati"]);
  });
  it("someone of another organisation named in passing is not a founder — 'Cyberstarts' Gili Raanan'", () => {
    expect(foundersFromText("Cyera was founded by Cyberstarts' Gili Raanan and Tamar Bar-Ilan.", "Cyera").map((f) => f.name)).toEqual(["Tamar Bar-Ilan"]);
  });
});

describe("a founder comes only from the extraction, with evidence (owner, 2026-10-29)", () => {
  it("a 'founded by' sentence alone adds no one — Thinking Machines' extra names are only reported", () => {
    const sources = [{ url: "https://www.builtinsf.com/articles/thinking-machines-lab", title: "Thinking Machines Lab", content: "Thinking Machines Lab was founded by Mira Murati and John Schulman." }];
    expect(founderNamesNotExtracted([{ name: "Mira Murati" }], sources, "Thinking Machines Lab")).toEqual(["John Schulman"]);
    expect(founderNamesNotExtracted([{ name: "Mira Murati" }, { name: "John Schulman" }], sources, "Thinking Machines Lab")).toEqual([]);
  });
});


describe("a founder's name has no title (owner, 2026-11-01: 'Prof. Matt Niessner')", () => {
  it("strips honorifics", async () => {
    const { stripHonorific } = await import("./people");
    expect(stripHonorific("Prof. Matt Niessner")).toBe("Matt Niessner");
    expect(stripHonorific("Dr Elad Walach")).toBe("Elad Walach");
    expect(stripHonorific("Kiwon Lee 님")).toBe("Kiwon Lee"); // Ybrain, model check 2026-11-02
    expect(stripHonorific("Drew Houston")).toBe("Drew Houston");
  });
});

describe("a bio keeps only the sentences its sources support (owner, 2026-11-03 — field review run 1)", () => {
  it("drops 'described as founded by a veteran' when no source says it, keeps what the source says", async () => {
    const { supportedBio } = await import("./people");
    const source = "Raycho Raychev. Founder and CEO, EnduroSat. Raychev founded EnduroSat in 2015 in Sofia.";
    expect(supportedBio("Raycho Raychev is the founder and CEO of EnduroSat. He founded the company in 2015, and it is described as founded by a veteran.", [source], "Raycho Raychev"))
      .toBe("Raycho Raychev is the founder and CEO of EnduroSat.");
    expect(supportedBio("He previously led SpaceX launches.", [source], "Raycho Raychev")).toBeNull();
  });
});

describe("roles beside the name; bio sentences about the person (owner, 2026-11-03 — field review run 2)", () => {
  it("a leader's title is checked against the source", async () => {
    const { roleSupported } = await import("./people");
    const npcx = "Our team. Michael Puscar, Co-Founder & CEO. Michael is a serial entrepreneur, investor, technologist and published data scientist. Jane Roe, CTO. Jane leads engineering at NPCx and previously built game engines for many studios over a long career.";
    expect(roleSupported("Michael Puscar", "Chief Technology Officer", [npcx], ["Jane Roe"])).toBe(false);
    expect(roleSupported("Michael Puscar", "Co-Founder & CEO", [npcx], ["Jane Roe"])).toBe(true);
    expect(roleSupported("Michael Puscar", "CTO", ["Michael Puscar\nCo-Founder & CEO\nJane Roe\nCTO"], ["Jane Roe"])).toBe(false);
    expect(roleSupported("Jane Roe", "CTO", ["Michael Puscar\nCo-Founder & CEO\nJane Roe\nCTO"], ["Michael Puscar"])).toBe(true);
    expect(roleSupported("Sumit Jain", "Co-Founder & CEO, Unacademy Test Prep", ["Sumit Jain, CEO of Unacademy Test Prep, said the unit will grow."])).toBe(false);
    expect(roleSupported("Kristina Cross", "VP Sales, North America", ["Kristina Cross — VP Sales, North America"])).toBe(true);
    expect(roleSupported("Liron Bitan", "Head of R&D", ["Liron Bitan"])).toBe(true);
  });
  it("a bio keeps only sentences about the person, with roles the source gives", async () => {
    const { supportedBio } = await import("./people");
    const calcalist = "IBM is acquiring Israeli data observability startup Databand.ai in July 2022. Founded in 2018 by CEO Josh Benamram, Victor Shafran, and CTO Evgeny Shulman.";
    expect(supportedBio("Databand was acquired by IBM in July 2022.", [calcalist], "Josh Benamram")).toBeNull();
    const cdata = "CData Software. Leadership: Amit Sharma, Chief Executive Officer. CData is a company founded by technologists to serve innovators.";
    expect(supportedBio("Amit Sharma is the founder and CEO of CData Software. CData describes itself as a company founded by technologists.", [cdata], "Amit Sharma")).toBeNull();
  });
});

describe("a person's card on a team page, by the HTML (owner, 2026-11-03)", () => {
  const grid = `<html><body><section class="team">
    <div class="card"><img src="m.jpg"><h3>Michael Puscar</h3><p class="role">Co-Founder &amp; CEO</p></div>
    <div class="card"><img src="j.jpg"><h3>Jane Roe</h3><p class="role">CTO</p></div>
    <div class="card"><img src="k.jpg"><h3>Kim Lee</h3><p class="role">VP Sales</p></div>
  </section></body></html>`;
  it("the card holds the person's own title only — even when the next person was not extracted", async () => {
    const { personCardsInHtml, roleSupported } = await import("./people");
    const cards = personCardsInHtml(grid, "Michael Puscar");
    expect(cards).toEqual(["michael puscar co-founder & ceo"]);
    expect(cards.some((c) => roleSupported("Michael Puscar", "CTO", [c]))).toBe(false);
    expect(cards.some((c) => roleSupported("Michael Puscar", "Co-Founder & CEO", [c]))).toBe(true);
    expect(personCardsInHtml(grid, "Jane Roe").some((c) => roleSupported("Jane Roe", "Chief Technology Officer", [c]))).toBe(true);
  });
  it("name and title in plain sibling divs; the name not on the page", async () => {
    const { personCardsInHtml } = await import("./people");
    const plain = `<body><div><div><div>Liron Bitan</div><div>VP R&amp;D</div></div><div><div>Kristina Cross</div><div>VP Sales</div></div></div></body>`;
    expect(personCardsInHtml(plain, "Liron Bitan")).toEqual(["liron bitan vp r&d"]);
    expect(personCardsInHtml(plain, "Nobody Here")).toEqual([]);
  });
});

import { titleFromCard } from "./people";
describe("a leader's title read from the site's card when the extraction gave none (owner, 2026-11-06 — Quris AI)", () => {
  it("takes the title after the name and its credentials", () => {
    expect(titleFromCard("Shelly Maman, PhD", "shelly maman, phd head of strategic alliances")).toBe("Head of Strategic Alliances");
    expect(titleFromCard("Amir Bein, RD, PhD", "amir bein, rd, phd svp of biology")).toBe("SVP of Biology");
    expect(titleFromCard("Shahar Harel", "shahar harel vp of ai")).toBe("VP of AI");
  });
  it("stops at the first sentence stop", () => {
    expect(titleFromCard("Ayelet Richter", "ayelet richter vp business development & us gm. ayelet joined in 2020 from sap.")).toBe("VP Business Development & US GM");
  });
  it("gives nothing when the card holds no role", () => {
    expect(titleFromCard("Jane Doe", "jane doe joined us from a bank and loves hiking")).toBeNull();
    expect(titleFromCard("Jane Doe", "something else entirely")).toBeNull();
  });
});

import { bioFromCard, personCardsInHtml } from "./people";
describe("the biography a team page's card carries, word for word (owner, 2026-11-10)", () => {
  const html = `<html><body><div class="team"><div class="card"><h3>Dr. Jane Rivera</h3><p>Chief Technology Officer</p>
    <p>Jane has spent fifteen years building distributed systems at scale. Before founding the company she led platform engineering at a large payments provider and holds a PhD in computer science from MIT.</p><a>LinkedIn</a><a>Read more</a></div>
    <div class="card"><h3>Sam Cohen</h3><p>CEO</p><p>Sam writes the strategy.</p></div></div></body></html>`;
  it("keeps the card's sentences as written, without the name, title and buttons", () => {
    const [card] = personCardsInHtml(html, "Jane Rivera", ["Sam Cohen"], { keepCase: true, maxLen: 1500 });
    const bio = bioFromCard(card, "Jane Rivera", "Chief Technology Officer");
    expect(bio).toBe("Jane has spent fifteen years building distributed systems at scale. Before founding the company she led platform engineering at a large payments provider and holds a PhD in computer science from MIT.");
  });
  it("a caption is not a biography; a card with only the title gives none", () => {
    const [card] = personCardsInHtml(html, "Sam Cohen", ["Jane Rivera"], { keepCase: true, maxLen: 1500 });
    expect(bioFromCard(card, "Sam Cohen", "CEO")).toBeNull();
    expect(bioFromCard("Jane Rivera Chief Technology Officer", "Jane Rivera", "Chief Technology Officer")).toBeNull();
  });
  it("the card search is unchanged without the options", () => {
    expect(personCardsInHtml(html, "Jane Rivera", ["Sam Cohen"])[0]).toBe(personCardsInHtml(html, "Jane Rivera", ["Sam Cohen"])[0].toLowerCase());
  });
});
