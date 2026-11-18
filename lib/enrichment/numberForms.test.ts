import { describe, it, expect } from "vitest";
import { numberStatedIn as ok, claimValue } from "./numberForms";
describe("a number in its local forms (owner, batch 7)", () => {
  it("thousands", () => {
    for (const t of ["mais de 2.500 empresas", "more than 2,500 companies", "über 2 500 Unternehmen", "más de 2500 empresas", "2 500 clients"]) expect(ok("2500", t), t).toBe(true);
  });
  it("with units", () => {
    expect(ok("2500", "mais de 2,5 mil empresas")).toBe(true);
    expect(ok("2500", "2,5 mil clientes")).toBe(true);
    expect(ok("2500000", "R$ 2,5 milhões em vendas")).toBe(true);
    expect(ok("2.5B", "valued at 2.5 billion")).toBe(true);
    expect(ok("2.5B", "valued at $2,500,000,000")).toBe(true);
    expect(ok("25M", "raised 25 million dollars")).toBe(true);
    expect(ok("25M", "levantou 25 milhões")).toBe(true);
  });
  it("not another value, and a token of its own", () => {
    expect(ok("2500", "more than 3,500 companies")).toBe(false);
    expect(ok("2B", "a B2B enterprise application")).toBe(false);
    expect(ok("25M", "raised 2.5 million")).toBe(false);
    expect(claimValue("5%")).toBe(5);
  });
});
