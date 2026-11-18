import { SKR04_RENTAL_2026 } from "@hv/db";
import { describe, expect, it } from "vitest";
import { isMessageKey } from "./messages";

describe("chart of accounts", () => {
  it("has a name in the interface catalogs for every account", () => {
    expect(SKR04_RENTAL_2026.map((a) => `account.${a.code}`).filter((key) => !isMessageKey(key))).toEqual([]);
  });
});
