import { describe, it, expect } from "vitest";
import { buildSimpleLines } from "@/mcp/server";

describe("buildSimpleLines (MCP)", () => {
  it("übernimmt discountAmount (Euro) als discountCents je Position", async () => {
    const lines = await buildSimpleLines("org-test-mcp", [
      { description: "Beratung", quantity: 2, unitPriceEuro: 100, discountAmount: 5.5 },
    ]);
    expect(lines[0].discountCents).toBe(550);
    expect(lines[0].discountPermille).toBe(0);
  });

  it("kombiniert discountPercent und discountAmount", async () => {
    const lines = await buildSimpleLines("org-test-mcp", [
      { description: "Beratung", quantity: 1, unitPriceEuro: 200, discountPercent: 10, discountAmount: 2 },
    ]);
    expect(lines[0].discountPermille).toBe(100);
    expect(lines[0].discountCents).toBe(200);
  });

  it("ohne discountAmount bleibt discountCents 0", async () => {
    const lines = await buildSimpleLines("org-test-mcp", [{ description: "Beratung", quantity: 1, unitPriceEuro: 50 }]);
    expect(lines[0].discountCents).toBe(0);
  });
});
