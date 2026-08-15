import { NextRequest } from "next/server";

import { proxy } from "@/proxy";

describe("application proxy", () => {
  it("returns a real 404 for the retired Orb study route", async () => {
    const response = await proxy(new NextRequest("http://localhost/orb-preview"));

    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
