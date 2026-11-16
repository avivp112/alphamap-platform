import { describe, it, expect } from "vitest";
import { looksEnglish, translateItems, markTranslatedQuote, quotePair, parseNumberedTranslation, TRANSLATION_MARK } from "./translate";

const pt = "A saúde é complexa, mas o seu cuidado não precisa ser. Conheça os planos de saúde da Sami com médico pessoal, atendimento rápido e aplicativo para toda a família e para as empresas. ".repeat(3);
const en = "We build software for hospitals and our platform helps the teams that work with patients. You can use it on your phone, and it is made for all of them. ".repeat(3);
const ar = "نحن بنك رقمي يقدم خدمات مصرفية للأفراد والشركات من خلال تطبيق الجوال ويتيح تحويل الأموال بسهولة وأمان. ".repeat(4);

describe("translation before verification (owner, round 10)", () => {
  it("tells English from Portuguese, Arabic and Polish", () => {
    expect(looksEnglish(en)).toBe(true);
    expect(looksEnglish(pt)).toBe(false);
    expect(looksEnglish(ar)).toBe(false);
    expect(looksEnglish("Zbudowaliśmy platformę dla szpitali i klinik. Nasz zespół pracuje z pacjentami w całej Polsce i oferuje opiekę dla każdego. ".repeat(3))).toBe(false);
    expect(looksEnglish("short")).toBe(true);
  });
  it("appends the translation, line by line, to non-English items only, once; a quote goes back to its original line", async () => {
    const client = { messages: { create: async (req: { messages: Array<{ content: string }> }) => ({ content: [{ type: "text", text: req.messages[0].content.split("\n").map((l) => { const [n] = l.split("\t"); return `${n}\t${n === "1" ? "Sami sells health plans with a personal doctor." : "It was founded by Vitor Asseituno in 2020."}`; }).join("\n") }] }) } } as never;
    const items = [{ url: "https://sami.com.br", content: pt.trim().replace(/\. /g, ".\n") }, { url: "https://x.com", content: en }];
    expect(await translateItems(items, client, "m")).toBe(1);
    expect(items[0].content).toContain(TRANSLATION_MARK);
    expect(items[1].content).toBe(en);
    expect(await translateItems(items, client, "m")).toBe(0);
    expect(markTranslatedQuote("It was founded by Vitor Asseituno in 2020.", items[0] as never)).toMatch(/^\[machine translation\]/);
    expect(markTranslatedQuote("A saúde é complexa", items[0] as never)).toBe("A saúde é complexa");
    const pair = quotePair("It was founded by Vitor Asseituno in 2020.", items[0] as never);
    expect(pair.translated).toBe("It was founded by Vitor Asseituno in 2020.");
    expect(pair.original).toContain("saúde");
    expect(quotePair("A saúde é complexa, mas o seu cuidado não precisa ser.", items[0] as never)).toEqual({ original: "A saúde é complexa, mas o seu cuidado não precisa ser.", translated: null });
  });
  it("reads a numbered answer back against the lines it was given", () => {
    expect(parseNumberedTranslation("1\tHello world\n3\tThird", ["a", "b", "c"])).toEqual([{ original: "a", english: "Hello world" }, { original: "c", english: "Third" }]);
  });
});
