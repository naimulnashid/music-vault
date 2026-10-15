/**
 * Fractional index strings for list ordering (playlists, playlist items).
 *
 * Keys are base-62 strings ordered lexicographically. Inserting between two
 * keys never touches sibling rows, so concurrent reorders on different
 * devices merge cleanly. The scheme is the well-known variable-length-integer
 * + fraction design (as used by Figma): the first character encodes the
 * integer part's length, giving unbounded headroom both when appending
 * ('a0' → 'a1' → … → 'b00' → …) and prepending ('a0' → 'Zz' → … ).
 *
 * `keyBetween(null, null)` is 'a0' — the schema default for `position`.
 */

const DIGITS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

const SMALLEST_KEY = "A" + DIGITS[0].repeat(26);

function integerLength(head: string): number {
  if (head >= "a" && head <= "z") return head.charCodeAt(0) - "a".charCodeAt(0) + 2;
  if (head >= "A" && head <= "Z") return "Z".charCodeAt(0) - head.charCodeAt(0) + 2;
  throw new Error(`invalid order key head: ${head}`);
}

function integerPart(key: string): string {
  const len = integerLength(key[0]);
  if (len > key.length) throw new Error(`invalid order key: ${key}`);
  return key.slice(0, len);
}

function validateInteger(int: string): void {
  if (int.length !== integerLength(int[0])) throw new Error(`invalid integer part: ${int}`);
}

export function validateOrderKey(key: string): void {
  if (key === SMALLEST_KEY) throw new Error(`invalid order key: ${key}`);
  const int = integerPart(key); // throws on a bad head/length
  const frac = key.slice(int.length);
  if (frac.endsWith(DIGITS[0])) throw new Error(`order key fraction ends in smallest digit: ${key}`);
}

/** Next integer, or null when the space is exhausted (practically unreachable). */
function incrementInteger(int: string): string | null {
  validateInteger(int);
  const [head, ...digits] = int.split("");
  let carry = true;
  for (let i = digits.length - 1; carry && i >= 0; i--) {
    const d = DIGITS.indexOf(digits[i]) + 1;
    if (d === DIGITS.length) {
      digits[i] = DIGITS[0];
    } else {
      digits[i] = DIGITS[d];
      carry = false;
    }
  }
  if (!carry) return head + digits.join("");
  if (head === "Z") return "a" + DIGITS[0];
  if (head === "z") return null;
  const nextHead = String.fromCharCode(head.charCodeAt(0) + 1);
  // Positive heads grow their digit count; negative heads shrink it.
  if (nextHead > "a") digits.push(DIGITS[0]);
  else digits.pop();
  return nextHead + digits.join("");
}

/** Previous integer, or null when the space is exhausted. */
function decrementInteger(int: string): string | null {
  validateInteger(int);
  const [head, ...digits] = int.split("");
  let borrow = true;
  for (let i = digits.length - 1; borrow && i >= 0; i--) {
    const d = DIGITS.indexOf(digits[i]) - 1;
    if (d === -1) {
      digits[i] = DIGITS[DIGITS.length - 1];
    } else {
      digits[i] = DIGITS[d];
      borrow = false;
    }
  }
  if (!borrow) return head + digits.join("");
  if (head === "a") return "Z" + DIGITS[DIGITS.length - 1];
  if (head === "A") return null;
  const prevHead = String.fromCharCode(head.charCodeAt(0) - 1);
  // Mirrors incrementInteger: crossing back below 'a' grows the digit count.
  if (prevHead < "Z") digits.push(DIGITS[DIGITS.length - 1]);
  else digits.pop();
  return prevHead + digits.join("");
}

/**
 * A fraction string strictly between a and b, where '' is treated as the
 * lower bound and null as +infinity. a and b must not end in the smallest
 * digit and a must sort before b.
 */
function midpoint(a: string, b: string | null): string {
  if (b !== null && a >= b) throw new Error(`midpoint: ${a} >= ${b}`);
  if (a.endsWith(DIGITS[0]) || (b !== null && b.endsWith(DIGITS[0]))) {
    throw new Error("midpoint: trailing smallest digit");
  }
  if (b !== null) {
    // Strip the longest common prefix and recurse on the tail.
    let n = 0;
    while ((a[n] ?? DIGITS[0]) === b[n]) n++;
    if (n > 0) return b.slice(0, n) + midpoint(a.slice(n), b.slice(n));
  }
  const digitA = a === "" ? 0 : DIGITS.indexOf(a[0]);
  const digitB = b === null ? DIGITS.length : DIGITS.indexOf(b[0]);
  if (digitB - digitA > 1) {
    return DIGITS[Math.round((digitA + digitB) / 2)];
  }
  // Consecutive first digits: extend under b if it has room, else under a.
  if (b !== null && b.length > 1) return b[0];
  return DIGITS[digitA] + midpoint(a.slice(1), null);
}

/**
 * Returns a key strictly between a and b (lexicographically). null bounds
 * mean the start/end of the list: keyBetween(null, null) === 'a0'.
 */
export function keyBetween(a: string | null, b: string | null): string {
  if (a !== null) validateOrderKey(a);
  if (b !== null) validateOrderKey(b);
  if (a !== null && b !== null && a >= b) throw new Error(`keyBetween: ${a} >= ${b}`);

  if (a === null) {
    if (b === null) return "a" + DIGITS[0];
    const intB = integerPart(b);
    const fracB = b.slice(intB.length);
    if (intB === SMALLEST_KEY) return intB + midpoint("", fracB);
    if (intB < b) return intB; // b has a fraction — its bare integer sorts before it
    const prev = decrementInteger(intB);
    if (prev === null) throw new Error("keyBetween: cannot go below the smallest key");
    return prev;
  }

  if (b === null) {
    const intA = integerPart(a);
    const fracA = a.slice(intA.length);
    const next = incrementInteger(intA);
    return next === null ? intA + midpoint(fracA, null) : next;
  }

  const intA = integerPart(a);
  const fracA = a.slice(intA.length);
  const intB = integerPart(b);
  const fracB = b.slice(intB.length);
  if (intA === intB) return intA + midpoint(fracA, fracB);
  const next = incrementInteger(intA);
  if (next === null) throw new Error("keyBetween: cannot go above the largest key");
  if (next < b) return next;
  return intA + midpoint(fracA, null);
}

/** n distinct ascending keys strictly between a and b. */
export function nKeysBetween(a: string | null, b: string | null, n: number): string[] {
  if (n <= 0) return [];
  if (n === 1) return [keyBetween(a, b)];
  if (b === null) {
    const keys: string[] = [keyBetween(a, null)];
    for (let i = 1; i < n; i++) keys.push(keyBetween(keys[i - 1], null));
    return keys;
  }
  if (a === null) {
    const keys: string[] = [keyBetween(null, b)];
    for (let i = 1; i < n; i++) keys.push(keyBetween(null, keys[i - 1]));
    return keys.reverse();
  }
  const mid = Math.trunc(n / 2);
  const center = keyBetween(a, b);
  return [...nKeysBetween(a, center, mid), center, ...nKeysBetween(center, b, n - mid - 1)];
}
