import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/client", () => ({ prisma: {} }));

import { ingestSchema, parseIngestKeys, workspaceForKey } from "@/lib/leads/ingest";

const KEY = "k".repeat(40);
const OTHER = "z".repeat(40);

describe("parseIngestKeys", () => {
  it("reads a key → workspace map", () => {
    const keys = parseIngestKeys(JSON.stringify({ [KEY]: "ws_sa", [OTHER]: "ws_fvr" }));
    expect(keys.get(KEY)).toBe("ws_sa");
    expect(keys.size).toBe(2);
  });
  it("ignores short keys and empty workspaces", () => {
    expect(parseIngestKeys(JSON.stringify({ corta: "ws", [KEY]: "" })).size).toBe(0);
  });
  it("disables ingest on bad JSON or missing env", () => {
    expect(parseIngestKeys("{no es json").size).toBe(0);
    expect(parseIngestKeys(undefined).size).toBe(0);
    expect(parseIngestKeys("[]").size).toBe(0);
  });
});

describe("workspaceForKey", () => {
  const keys = parseIngestKeys(JSON.stringify({ [KEY]: "ws_sa", [OTHER]: "ws_fvr" }));
  it("binds each key to its own workspace", () => {
    expect(workspaceForKey(`Bearer ${KEY}`, keys)).toBe("ws_sa");
    expect(workspaceForKey(`bearer ${OTHER}`, keys)).toBe("ws_fvr");
  });
  it("rejects missing, malformed or unknown keys", () => {
    expect(workspaceForKey(null, keys)).toBeNull();
    expect(workspaceForKey(KEY, keys)).toBeNull();
    expect(workspaceForKey(`Bearer ${"x".repeat(40)}`, keys)).toBeNull();
    expect(workspaceForKey(`Bearer ${KEY}`, new Map())).toBeNull();
  });
});

describe("ingestSchema", () => {
  const base = { email: " Ana@Empresa.MX ", origin: "senor-auditor/autodiagnostico", consent: true };
  it("normalizes the email and fills defaults", () => {
    const r = ingestSchema.parse(base);
    expect(r.email).toBe("ana@empresa.mx");
    expect(r.newsletterOptIn).toBe(false);
    expect(r.locale).toBe("es");
  });
  it("requires explicit consent and an origin", () => {
    expect(ingestSchema.safeParse({ ...base, consent: false }).success).toBe(false);
    expect(ingestSchema.safeParse({ email: "a@b.mx", consent: true }).success).toBe(false);
  });
  it("keeps the tool's data", () => {
    const r = ingestSchema.parse({ ...base, data: { resultado: { total: 52 } } });
    expect(r.data).toEqual({ resultado: { total: 52 } });
  });
});
