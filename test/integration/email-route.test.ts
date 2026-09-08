import { describe, it, expect, vi } from "vitest";

// getCurrentUserId nutzt cookies() aus next/headers; ausserhalb eines echten
// Request-Kontexts wirft das. Fuer den 413-Test wird die Route davor bereits
// verlassen, aber der Mock schuetzt auch kuenftige Tests in dieser Datei.
vi.mock("@/lib/auth/server", () => ({
  getCurrentUserId: async () => "test-user",
}));

import { POST } from "@/app/api/emails/send/route";

/**
 * Ein ReadableStream ruft pull() intern selbststaendig auf, um seine Queue zu fuellen —
 * unabhaengig davon, ob ein Consumer tatsaechlich liest. Ob der Request-Body GELESEN
 * wurde (formData()/json()/getReader().read() etc.), zeigt zuverlaessig nur `bodyUsed`.
 */
function streamingRequest(headers: Record<string, string> = {}): Request {
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.enqueue(new TextEncoder().encode("x"));
    },
  });
  return new Request("http://localhost/api/emails/send", {
    method: "POST",
    headers,
    body,
    // duplex ist bei streamenden Request-Bodies erforderlich (undici), im DOM-Typ noch nicht abgebildet.
    duplex: "half",
  } as RequestInit & { duplex: "half" });
}

describe("POST /api/emails/send: Content-Length-Pruefung", () => {
  it("content-length ueber dem Limit -> 413, Body wird nicht gelesen", async () => {
    const req = streamingRequest({ "content-length": String(30 * 1024 * 1024) });

    const res = await POST(req);
    expect(res.status).toBe(413);
    const json = await res.json();
    expect(json.error).toBe("Anfrage zu gross");
    expect(req.bodyUsed).toBe(false);
  });

  it("fehlende content-length -> 413, Body wird nicht gelesen", async () => {
    const req = streamingRequest();
    // Node/undici setzt bei einem Stream-Body von sich aus keinen content-length-Header.
    expect(req.headers.get("content-length")).toBeNull();

    const res = await POST(req);
    expect(res.status).toBe(413);
    const json = await res.json();
    expect(json.error).toBe("Anfrage zu gross");
    expect(req.bodyUsed).toBe(false);
  });
});
