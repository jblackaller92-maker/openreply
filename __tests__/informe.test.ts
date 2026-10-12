import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/client", () => ({ prisma: {} }));

import { certificates, countryByA2, findCountry, findEmail, growth, ordinal, rank, stripEmails } from "@/lib/informe/datos";
import { buildReportEmail, highlights } from "@/lib/informe/email";
import { normalizeKeyword } from "@/lib/keywords/registry";

describe("findEmail", () => {
  it("pulls the address out of a chatty reply", () => {
    expect(findEmail("Hola! mi correo es Juan.Perez@Empresa.com.mx y soy de México")).toBe("juan.perez@empresa.com.mx");
  });
  it("drops a trailing period", () => {
    expect(findEmail("ana@fvr.mx.")).toBe("ana@fvr.mx");
  });
  it("returns null when there is none", () => {
    expect(findEmail("survey")).toBeNull();
    expect(findEmail("me escribes a arroba gmail")).toBeNull();
  });
});

describe("findCountry", () => {
  it("reads Spanish and English names, with or without accents", () => {
    expect(findCountry("México")).toBe("MX");
    expect(findCountry("soy de mexico")).toBe("MX");
    expect(findCountry("Estados Unidos")).toBe("US");
    expect(findCountry("United States")).toBe("US");
    expect(findCountry("Perú")).toBe("PE");
    expect(findCountry("Spain")).toBe("ES");
  });
  it("prefers the longest name", () => {
    expect(findCountry("República Dominicana")).toBe("DO");
  });
  it("does not read 'us' in an English sentence as a country", () => {
    expect(findCountry("please send it to us")).toBeNull();
  });
  it("never reads an email domain as a country", () => {
    expect(findCountry(stripEmails("Luis@Empresa.MX"))).toBeNull();
    expect(findCountry(stripEmails("ana@empresa.com.mx, Perú"))).toBe("PE");
  });
  it("returns null when no country is named", () => {
    expect(findCountry("gracias!")).toBeNull();
  });
});

describe("survey figures", () => {
  const mx = countryByA2("MX")!;
  it("match ISO's file for Mexico", () => {
    expect(certificates(mx, "9001")).toBe(10530);
    expect(Math.round(growth(mx, "9001")!)).toBe(16);
    expect(rank(mx, "9001")).toEqual([23, 226]);
  });
  it("hide the percentage when the 2024 base is too small", () => {
    expect(growth(mx, "29001")).toBeNull(); // 3 → 9
  });
  it("format ranks per language", () => {
    expect(ordinal(23, "es")).toBe("23.º");
    expect(ordinal(23, "en")).toBe("23rd");
    expect(ordinal(11, "en")).toBe("11th");
  });
});

describe("report email", () => {
  it("names the country, links the button and stays far below Gmail's 102 KB clip", () => {
    const email = buildReportEmail({
      countryA2: "MX",
      locale: "es",
      reportUrl: "https://mkt.fvr.mx/informe/abc",
      unsubscribeUrl: "https://mkt.fvr.mx/informe/baja/abc",
    });
    expect(email.subject).toBe("México en el ISO Survey 2025: tu informe está listo");
    expect(email.html).toContain('href="https://mkt.fvr.mx/informe/abc"');
    expect(email.html).toContain("10,530");
    expect(email.html).toContain("Ver informe");
    expect(email.html).not.toContain("data:");
    expect(Buffer.byteLength(email.html)).toBeLessThan(60_000);
  });
  it("speaks English for the US account", () => {
    const email = buildReportEmail({ countryA2: "US", locale: "en", reportUrl: "u", unsubscribeUrl: "b" });
    expect(email.subject).toContain("United States");
    expect(email.html).toContain("View report");
  });
  it("computes three highlights", () => {
    expect(highlights(countryByA2("MX")!, "es")).toHaveLength(3);
  });
});

describe("keyword registry", () => {
  it("treats case and accents as the same word", () => {
    expect(normalizeKeyword(" Survey ")).toBe(normalizeKeyword("SÚRVEY"));
  });
});
