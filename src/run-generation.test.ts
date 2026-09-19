import { describe, expect, it } from "vitest";
import { createRunGeneration } from "./run-generation";

describe("run generation", () => {
  it("invalidates events captured by an older request", () => {
    const generation = createRunGeneration();
    const first = generation.next();
    const second = generation.next();

    expect(generation.isCurrent(first)).toBe(false);
    expect(generation.isCurrent(second)).toBe(true);
  });
});
