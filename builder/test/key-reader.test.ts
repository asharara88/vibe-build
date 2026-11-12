// The reader that looks for the model key in a text (src/gateway/key-reader.ts): fixed cases
// for each rule, then many random keys written with random escapes, layer upon layer.
import { describe, expect, it } from "vitest";
import { spellsKey } from "../src/gateway/key-reader.js";

const KEY = "sk-u0041bc-x41zz-Test_9";

describe("the key reader", () => {
  it("finds the key written plainly, and nothing in a text without it", () => {
    expect(spellsKey(`before ${KEY} after`, KEY)).toBe(true);
    expect(spellsKey("nothing here", KEY)).toBe(false);
    expect(spellsKey(KEY.slice(0, -1), KEY)).toBe(false);
    expect(spellsKey("", KEY)).toBe(false);
    expect(spellsKey("anything", "")).toBe(false);
  });

  it("ignores backslashes, one or many, anywhere in the key", () => {
    expect(spellsKey(KEY.split("").join("\\"), KEY)).toBe(true);
    expect(spellsKey(`\\${KEY}`, KEY)).toBe(true);
    expect(spellsKey(KEY.replace("-", "\\\\\\\\-"), KEY)).toBe(true);
    expect(spellsKey(`${KEY.slice(0, 5)}${"\\".repeat(100_000)}${KEY.slice(5)}`, KEY)).toBe(true);
  });

  it("reads \\\\uHHHH and \\\\xHH as the character they name, in either letter case of the digits", () => {
    expect(spellsKey(KEY.replace(/-/g, "\\u002d"), KEY)).toBe(true);
    expect(spellsKey(KEY.replace(/-/g, "\\u002D"), KEY)).toBe(true);
    expect(spellsKey(KEY.replace(/-/g, "\\x2d"), KEY)).toBe(true);
    expect(spellsKey([...KEY].map((c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`).join(""), KEY)).toBe(true);
  });

  it("follows both readings where a backslash stands before a u or an x that is part of the key", () => {
    // The key holds "u0041" and "x41". With a backslash in front, those read as "A" under one rule and as themselves under the other.
    expect(spellsKey(KEY.replace("u0041", "\\u0041"), KEY)).toBe(true);
    expect(spellsKey(KEY.replace("x41", "\\x41"), KEY)).toBe(true);
    expect(spellsKey("sk-Abc-Azz-Test_9", KEY)).toBe(false);
  });

  it("reads an escape whose backslash is itself written as an escape, and escapes inside escapes", () => {
    expect(spellsKey(KEY.replace(/-/g, "\\u005cu002d"), KEY)).toBe(true);
    expect(spellsKey(KEY.replace(/-/g, "\\x5cx2d"), KEY)).toBe(true);
    expect(spellsKey(KEY.replace(/-/g, "\\\\\\\\u002d"), KEY)).toBe(true);
    expect(spellsKey(JSON.stringify(JSON.stringify(JSON.stringify(`x ${KEY} y`))), KEY)).toBe(true);
  });

  it("does not take a text for the key when the escapes name other characters", () => {
    expect(spellsKey(KEY.replace(/-/g, "\\u002e"), KEY)).toBe(false);
    expect(spellsKey(KEY.replace(/-/g, "u002d"), KEY)).toBe(false); // no backslash: not an escape
    expect(spellsKey(`${"\\".repeat(50_000)} C:\\Users\\name \\frac{a}{b} ^\\d+\\.\\d+$`, KEY)).toBe(false);
  });

  it("does not read an escape whose own letter or digits are themselves escaped: the stated limit", () => {
    // These are outside the three rules, and the record says so. If the reader is ever extended to read them,
    // this test should be changed together with the record.
    expect(spellsKey("ab\\u\\0\\0\\2\\dcd", "ab-cd")).toBe(false);
    expect(spellsKey("ab\\u005c\\u0075002dcd", "ab-cd")).toBe(false);
  });

  it("finds the key however it is written within the three rules: 3,000 random keys, every character spelt at random", () => {
    // A small fixed random-number generator, so that a failure can be repeated.
    let seed = 20261112;
    const rnd = (n: number) => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed % n;
    };
    const alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_ux0041";
    const hex = (c: string, width: number) => {
      const h = c.charCodeAt(0).toString(16).padStart(width, "0");
      return rnd(2) ? h : h.toUpperCase();
    };
    // One backslash, written as itself or (rule 3) as an escape that names a backslash, to any depth.
    const slash = (depth: number): string => (depth === 0 || rnd(3) === 0 ? "\\" : slash(depth - 1) + (rnd(2) ? "u005c" : "x5C"));
    const slashes = (n: number): string => Array.from({ length: n }, () => slash(rnd(4))).join("");
    // One character of the key, written by rule 1, 2 or 3.
    const spell = (c: string): string => {
      const how = rnd(10);
      if (how < 5) return slashes(rnd(4)) + c;
      if (how < 8) return `${slashes(1 + rnd(3))}u${hex(c, 4)}`;
      return `${slashes(1 + rnd(3))}x${hex(c, 2)}`;
    };
    for (let n = 0; n < 3_000; n++) {
      const key = Array.from({ length: 8 + rnd(40) }, () => alphabet[rnd(alphabet.length)]!).join("");
      const written = [...key].map(spell).join("");
      const noise = () => Array.from({ length: rnd(30) }, () => (rnd(6) === 0 ? "\\" : alphabet[rnd(alphabet.length)]!)).join("");
      const text = `${noise()}${written}${noise()}`;
      if (!spellsKey(text, key)) throw new Error(`not found: key ${key} written as ${written}`);
      // The same text does not spell a longer key that ends in a character no spelling here can produce.
      if (spellsKey(text, `${key}#`)) throw new Error(`found where it is not: key ${key}# in ${text}`);
    }
  });
});
