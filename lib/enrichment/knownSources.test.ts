import { describe, it, expect } from "vitest";
import { remember, applyKnown, refreshDue, markKey, type KnownStore, type ReportRow } from "./knownSources";

const row = (field: string, after: string, extra: Partial<ReportRow> = {}): ReportRow => ({ company_id: "c1", company: "Pink Farms", field, before: "", after, source_url: "https://pf.com/about", quote: `${after} is here`, ...extra });
const page = (text: string | null) => async () => text;

describe("known sources (owner, round 10)", () => {
  it("remembers sourced values only, never ones marked wrong", () => {
    const store: KnownStore = {};
    const wrong = new Set([markKey("Pink Farms", "founder", "Bad Name")]);
    remember(store, [row("founder", "Geraldo Maia"), row("founder", "Bad Name"), row("hq_city", "São Paulo", { source_url: "" }), row("(nothing)", "")], "r1", "2026-11-15", wrong);
    expect(store.c1.map((e) => e.value)).toEqual(["Geraldo Maia"]);
  });
  it("carries a confirmed value the run did not find again (Pink Farms founders)", async () => {
    const store: KnownStore = {};
    remember(store, [row("founder", "Geraldo Maia"), row("founder", "Mateus Delalibera")], "r1", "2026-11-01");
    const r = await applyKnown(store, "c1", [row("founder", "Geraldo Maia")], "2026-11-15", page("Mateus Delalibera is here. Geraldo Maia is here."));
    expect(r.rows.map((x) => x.after).sort()).toEqual(["Geraldo Maia", "Mateus Delalibera"]);
    expect(r.carried[0].origin).toBe("known_source");
  });
  it("an unreadable page keeps the value, marked; a page without the quote sends it to review", async () => {
    const store: KnownStore = {};
    remember(store, [row("founder", "Geraldo Maia")], "r1", "2026-11-01");
    expect((await applyKnown(store, "c1", [], "2026-11-15", page(null))).carried[0].origin).toBe("known_source_stale_check_failed");
    const gone = await applyKnown(store, "c1", [], "2026-11-15", page("Nothing about anyone."));
    expect(gone.carried).toEqual([]);
    expect(gone.recheck).toHaveLength(1);
    expect(store.c1[0].status).toBe("quote_gone");
  });
  it("only the stable fields are carried (founder, founded_year, legal_name, company_number); a volatile one is searched again, not remembered (owner, 2026-11-23)", async () => {
    const store: KnownStore = {};
    remember(store, [row("leader", "Ann — CEO"), row("founded_year", "2016")], "r1", "2026-01-01");
    expect(refreshDue({ field: "leader", verified_at: "2026-01-01" }, "2026-11-15")).toBe(true);
    const r = await applyKnown(store, "c1", [], "2026-11-15", page("Ann — CEO is here 2016 is here"));
    expect(r.rows.map((x) => x.field)).toEqual(["founded_year"]);
    expect(r.refreshDue).toHaveLength(0);   // the leader is not a carried field at all: nothing is "due"
  });
  it("rounds, descriptions and the like are never carried from the memory; a value the owner locked still is", async () => {
    const store: KnownStore = {};
    remember(store, [row("round", "Series A $5M · 2020"), row("hq_city", "Toronto"), row("description", "Pink Farms grows food"), row("founder", "Ann — Founder")], "r1", "2026-11-10");
    const text = page("Series A $5M 2020 Toronto Pink Farms grows food Ann — Founder");
    const free = await applyKnown(store, "c1", [], "2026-11-15", text);
    expect(free.rows.map((x) => x.field)).toEqual(["founder"]);
    const locked = await applyKnown(store, "c1", [], "2026-11-15", text, new Set([markKey("Pink Farms", "hq_city", "Toronto")]));
    expect(locked.rows.map((x) => x.field).sort()).toEqual(["founder", "hq_city"]);
  });
  it("a locked value stays against a different new one; an unlocked one is replaced", async () => {
    const store: KnownStore = {};
    remember(store, [row("hq_city", "Toronto")], "r1", "2026-11-10");
    const text = page("Toronto is here");
    const unlocked = await applyKnown(store, "c1", [row("hq_city", "Calgary")], "2026-11-15", text);
    expect(unlocked.rows.map((x) => x.after)).toEqual(["Calgary"]);
    const locked = await applyKnown(store, "c1", [row("hq_city", "Calgary")], "2026-11-15", text, new Set([markKey("Pink Farms", "hq_city", "Toronto")]));
    expect(locked.rows.map((x) => x.after)).toEqual(["Toronto"]);
  });
});

describe("a quote from a machine translation (owner, round 10)", () => {
  it("is carried with the page readable, marked as not checkable", async () => {
    const store: KnownStore = {};
    remember(store, [{ company_id: "c1", company: "Sami", field: "founder", before: "", after: "Vitor Asseituno — Co-founder", source_url: "https://sami.com.br", quote: "[machine translation] founded by Vitor Asseituno" }], "r1", "2026-11-15");
    const r = await applyKnown(store, "c1", [], "2026-11-16", async () => "Fundada por Vitor Asseituno");
    expect(r.carried[0].origin).toBe("known_source_stale_check_failed");
  });
});

describe("the memory only grows, and a first false 'gone' is not for ever (owner, round 10)", () => {
  it("a single-valued field keeps its older value as superseded; seeding an older report after a newer one does not replace it", () => {
    const store: KnownStore = {};
    remember(store, [row("hq_city", "Toronto")], "r1", "2026-11-10");
    remember(store, [row("hq_city", "Calgary")], "r2", "2026-11-15");
    expect(store.c1.map((e) => `${e.value}:${e.status}`)).toEqual(["Toronto:superseded", "Calgary:ok"]);
    remember(store, [row("hq_city", "Ottawa")], "r0", "2026-11-01");
    expect(store.c1.find((e) => e.value === "Ottawa")?.status).toBe("superseded");
    expect(store.c1.find((e) => e.value === "Calgary")?.status).toBe("ok");
    expect(store.c1).toHaveLength(3);
  });
  it("a quote that the page still mostly shares is confirmed; one that shares little is 'gone', and is checked again next time", async () => {
    const store: KnownStore = {};
    remember(store, [row("founder", "Alastair Mills — Founder", { quote: "Six Degrees delivers hybrid cloud, cyber security and modern work managed services to enterprises" })], "r1", "2026-11-10");
    const ok = await applyKnown(store, "c1", [], "2026-11-16", page("Hybrid cloud and cyber security: Six Degrees delivers modern work managed services for enterprise customers"));
    expect(ok.carried[0].origin).toBe("known_source");
    const gone = await applyKnown(store, "c1", [], "2026-11-16", page("A page about something else entirely: shipping rates and holiday opening times"));
    expect(gone.carried).toEqual([]);
    expect(store.c1[0].status).toBe("quote_gone");
    const again = await applyKnown(store, "c1", [], "2026-11-17", page("Six Degrees delivers hybrid cloud, cyber security and modern work managed services to enterprises"));
    expect(again.carried).toHaveLength(1);
    expect(store.c1[0].status).toBe("ok");
  });
});
