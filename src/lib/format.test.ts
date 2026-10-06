import { describe, expect, it } from "vitest";

import {
  emptyEntryInput,
  formatCode,
  formatDuration,
  formatRemaining,
  hueFor,
  initials,
  matchesQuery,
  tickRemaining,
  windowProgress,
} from "./format";

describe("formatCode", () => {
  it("splits six digit codes in half", () => {
    expect(formatCode("755224")).toBe("755 224");
  });

  it("splits eight digit codes in half", () => {
    expect(formatCode("84755224")).toBe("8475 5224");
  });

  it("leaves odd lengths alone", () => {
    expect(formatCode("12345")).toBe("12345");
  });

  it("passes through non numeric placeholders", () => {
    expect(formatCode("invalid")).toBe("invalid");
    expect(formatCode("")).toBe("");
  });
});

describe("formatRemaining", () => {
  it("renders seconds and hides a zero countdown", () => {
    expect(formatRemaining(23)).toBe("23s");
    expect(formatRemaining(0)).toBe("");
    expect(formatRemaining(-5)).toBe("");
  });
});

describe("formatDuration", () => {
  it("describes the auto lock choices", () => {
    expect(formatDuration(0)).toBe("Nonaktif");
    expect(formatDuration(60)).toBe("1 menit");
    expect(formatDuration(300)).toBe("5 menit");
    expect(formatDuration(3600)).toBe("1 jam");
    expect(formatDuration(45)).toBe("45 detik");
  });
});

describe("initials", () => {
  it("uses the first two letters of two words", () => {
    expect(initials("GitHub", "")).toBe("GI");
    expect(initials("", "user@example.com")).toBe("UE");
    expect(initials("My Bank", "user")).toBe("MB");
    expect(initials("", "")).toBe("?");
  });
});

describe("hueFor", () => {
  it("is stable for the same seed and spread across seeds", () => {
    expect(hueFor("GitHub")).toBe(hueFor("GitHub"));
    expect(hueFor("GitHub")).not.toBe(hueFor("GitLab"));
    expect(hueFor("GitHub")).toBeGreaterThanOrEqual(0);
    expect(hueFor("GitHub")).toBeLessThan(360);
  });
});

describe("windowProgress", () => {
  it("goes from 0 to 1 across the period", () => {
    expect(windowProgress(30, 30)).toBe(0);
    expect(windowProgress(15, 30)).toBe(0.5);
    expect(windowProgress(0, 30)).toBe(1);
  });

  it("clamps out of range values", () => {
    expect(windowProgress(999, 30)).toBe(0);
    expect(windowProgress(-1, 30)).toBe(1);
    expect(windowProgress(5, 0)).toBe(0);
  });
});

describe("tickRemaining", () => {
  it("keeps the countdown at rest when nothing elapsed", () => {
    expect(tickRemaining(30, 30, 0)).toBe(30);
    expect(tickRemaining(7, 30, 0)).toBe(7);
    expect(tickRemaining(1, 30, 0)).toBe(1);
  });

  it("counts down locally one second at a time", () => {
    expect(tickRemaining(30, 30, 1)).toBe(29);
    expect(tickRemaining(30, 30, 5)).toBe(25);
    expect(tickRemaining(7, 30, 3)).toBe(4);
  });

  it("wraps into the next window when the code rotates", () => {
    // remaining=1, one second later → full window again.
    expect(tickRemaining(1, 30, 1)).toBe(30);
    expect(tickRemaining(30, 30, 30)).toBe(30);
    // Two full windows passed.
    expect(tickRemaining(15, 30, 45)).toBe(30);
    // Mid-window phase is preserved across wraps.
    expect(tickRemaining(10, 30, 20)).toBe(20);
  });

  it("ignores negative elapsed time", () => {
    expect(tickRemaining(30, 30, -5)).toBe(30);
  });

  it("floors fractional elapsed seconds", () => {
    expect(tickRemaining(30, 30, 1.7)).toBe(29);
    expect(tickRemaining(30, 30, 22.03)).toBe(8);
  });

  it("passes through non TOTP values untouched", () => {
    expect(tickRemaining(5, 0, 3)).toBe(5);
  });
});

describe("matchesQuery", () => {
  const entry = {
    issuer: "GitHub",
    account: "octocat@example.com",
    algorithm: "SHA1",
    kind: "totp",
  };

  it("matches issuer, account and metadata case insensitively", () => {
    expect(matchesQuery(entry, "")).toBe(true);
    expect(matchesQuery(entry, "  ")).toBe(true);
    expect(matchesQuery(entry, "git")).toBe(true);
    expect(matchesQuery(entry, "OCTOCAT")).toBe(true);
    expect(matchesQuery(entry, "sha256")).toBe(false);
    expect(matchesQuery(entry, "hotp")).toBe(false);
    expect(matchesQuery(entry, "nonsense")).toBe(false);
  });
});

describe("emptyEntryInput", () => {
  it("starts with sane defaults", () => {
    expect(emptyEntryInput()).toEqual({
      issuer: "",
      account: "",
      secret: "",
      kind: "totp",
      algorithm: "SHA1",
      digits: 6,
      period: 30,
      counter: 0,
    });
  });
});
