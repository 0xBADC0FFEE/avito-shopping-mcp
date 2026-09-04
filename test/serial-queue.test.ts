import { describe, expect, it } from "vitest";

import { SerialQueue } from "../src/serial-queue.js";

describe("SerialQueue", () => {
  it("never overlaps tasks", async () => {
    const queue = new SerialQueue();
    const events: string[] = [];
    const first = queue.run(async () => {
      events.push("first:start");
      await new Promise((resolve) => setTimeout(resolve, 10));
      events.push("first:end");
    });
    const second = queue.run(async () => {
      events.push("second:start");
      events.push("second:end");
    });

    await Promise.all([first, second]);
    expect(events).toEqual(["first:start", "first:end", "second:start", "second:end"]);
  });
});
