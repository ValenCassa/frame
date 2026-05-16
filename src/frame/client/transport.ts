import type { RequestPayload, ResponseEnvelope } from "../core/wire";

export interface FrameTransport {
  send(req: RequestPayload): Promise<ResponseEnvelope>;
}

export const httpTransport = (baseUrl = "/api/frame"): FrameTransport => ({
  async send(req) {
    const res = await fetch(baseUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(req),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Frame request failed (${res.status}): ${text}`);
    }
    return (await res.json()) as ResponseEnvelope;
  },
});
