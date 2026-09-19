import type { DemoFixture } from "../replay.js";
import { insufficientEvidenceFixture } from "./insufficient-evidence.js";
import { successFixture } from "./success.js";
import { timeoutFixture } from "./timeout.js";

const demoFixtures: Readonly<Record<string, DemoFixture>> = {
  [successFixture.packageId]: successFixture,
  [insufficientEvidenceFixture.packageId]: insufficientEvidenceFixture,
  [timeoutFixture.packageId]: timeoutFixture,
};

export const getDemoFixture = (packageId: string) => demoFixtures[packageId];
