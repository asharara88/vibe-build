// Looking for the model key in a text that is about to leave the gateway or be stored.
//
// The question asked is: can the key be read out of this text by a reader that follows these
// rules, in any mixture, at any place in the text?
//   1. A character is taken as it is.
//   2. A backslash is ignored (so "\-" is "-", "\\t" is "t", and several backslashes in a row
//      are ignored together).
//   3. After a backslash, "uHHHH" (four hex digits) or "xHH" (two) may also be read as the
//      character it names. If that character is itself a backslash, it counts as one.
// Rules 2 and 3 can both apply to the same place ("A" is "A" under rule 3 and "u0041"
// under rule 2); both readings are followed.
//
// That covers the key written plainly; written inside JSON by a writer that escapes as
// JSON.stringify does; and such JSON written inside JSON again, to any depth (each layer only
// adds backslashes). It is one pass over the text, however many backslashes the text holds.
//
// What this reader does NOT read, stated so that nobody takes it for more than it is:
//   - an escape whose own letter or digits are themselves written as escapes or separated by
//     backslashes ("\u\0\0\2\d", or "\u005c\u0075002d");
//   - any other form: base64, percent-encoding, HTML entities, UTF-16, "\u{2d}", octal,
//     "\U0000002d".

const HEX = /^[0-9a-fA-F]+$/;

export function spellsKey(text: string, key: string): boolean {
  const m = key.length;
  if (m === 0) return false;
  if (text.includes(key)) return true;
  if (!text.includes("\\")) return false;

  // A state is (k, p): k characters of the key read so far; p is 1 when the last thing read
  // was a backslash. States waiting at a text position are kept in a small ring, because a
  // step moves at most 5 positions ahead. Each state is held once per position.
  const RING = 8;
  const width = 2 * (m + 1);
  const lists: number[][] = Array.from({ length: RING }, () => []);
  const marks: Uint8Array[] = Array.from({ length: RING }, () => new Uint8Array(width));
  const add = (at: number, k: number, p: number): void => {
    const slot = at % RING;
    const s = 2 * k + p;
    const mk = marks[slot]!;
    if (mk[s] === 0) {
      mk[s] = 1;
      lists[slot]!.push(s);
    }
  };
  const n = text.length;
  for (let i = 0; i < n; i++) {
    const slot = i % RING;
    const list = lists[slot]!;
    const mk = marks[slot]!;
    const c = text[i]!;
    // A fresh reading can begin at every position.
    if (mk[0] === 0) list.push(0);
    for (let j = 0; j < list.length; j++) {
      const s = list[j]!;
      const k = s >> 1;
      const p = s & 1;
      if (c === key[k]) {
        if (k + 1 === m) return true;
        add(i + 1, k + 1, 0);
      }
      if (c === "\\") add(i + 1, k, 1);
      if (p === 1 && (c === "u" || c === "x")) {
        const len = c === "u" ? 4 : 2;
        const digits = text.slice(i + 1, i + 1 + len);
        if (digits.length === len && HEX.test(digits)) {
          const named = String.fromCharCode(parseInt(digits, 16));
          if (named === "\\") add(i + 1 + len, k, 1);
          if (named === key[k]) {
            if (k + 1 === m) return true;
            add(i + 1 + len, k + 1, 0);
          }
        }
      }
    }
    for (let j = 0; j < list.length; j++) mk[list[j]!] = 0;
    list.length = 0;
  }
  return false;
}
