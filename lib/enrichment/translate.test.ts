import { describe, it, expect } from "vitest";
import { looksEnglish, translateItems, markTranslatedQuote, TRANSLATION_MARK } from "./translate";

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
  it("appends the translation to non-English items only, once, and marks quotes taken from it", async () => {
    const client = { messages: { create: async () => ({ content: [{ type: "text", text: "Sami sells health plans with a personal doctor. It was founded by Vitor Asseituno in 2020." }] }) } } as never;
    const items = [{ url: "https://sami.com.br", content: pt }, { url: "https://x.com", content: en }];
    expect(await translateItems(items, client, "m")).toBe(1);
    expect(items[0].content).toContain(TRANSLATION_MARK);
    expect(items[1].content).toBe(en);
    expect(await translateItems(items, client, "m")).toBe(0);
    expect(markTranslatedQuote("It was founded by Vitor Asseituno in 2020.", items[0] as never)).toMatch(/^\[machine translation\]/);
    expect(markTranslatedQuote("A saúde é complexa", items[0] as never)).toBe("A saúde é complexa");
  });
});
