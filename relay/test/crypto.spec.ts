import { describe, expect, it } from "vitest";

import {
  decryptJson,
  digestCanonicalEvent,
  encryptJson,
  eventEncryptionContext,
  generateSecureId,
  hashRelayToken,
  importEncryptionKey,
  importHmacKey,
  stateEncryptionContext,
} from "../src/crypto";
import { validateProposedNoteLimit } from "../src/validation";

/* begin[relay_crypto_tests] */
describe("relay cryptography", () => {
  it("hashes relay tokens deterministically without retaining the token", async () => {
    const key = await importHmacKey("synthetic-test-hmac-material");
    const token = generateSecureId("token");

    const firstHash = await hashRelayToken(token, key);
    const secondHash = await hashRelayToken(token, key);

    expect(firstHash).toBe(secondHash);
    expect(firstHash).not.toContain(token);
    expect(await hashRelayToken(`${token}-different`, key)).not.toBe(firstHash);
  });

  it("round trips AES-GCM data with the correct event context", async () => {
    const key = await importEncryptionKey(
      crypto.getRandomValues(new Uint8Array(32)),
    );
    const context = eventEncryptionContext("event_correct-context");
    const encrypted = await encryptJson(
      { property: "synthetic-property", note: "synthetic-note" },
      key,
      3,
      context,
    );

    await expect(
      decryptJson(encrypted, new Map([[3, key]]), context),
    ).resolves.toEqual({
      property: "synthetic-property",
      note: "synthetic-note",
    });

    const firstCharacter = encrypted.ciphertext[0] === "A" ? "B" : "A";
    const tampered = {
      ...encrypted,
      ciphertext: `${firstCharacter}${encrypted.ciphertext.slice(1)}`,
    };
    await expect(
      decryptJson(tampered, new Map([[3, key]]), context),
    ).rejects.toThrow();
  });

  it("rejects an event ciphertext under another event or purpose", async () => {
    const key = await importEncryptionKey(
      crypto.getRandomValues(new Uint8Array(32)),
    );
    const encrypted = await encryptJson(
      { eventType: "clock_in" },
      key,
      1,
      eventEncryptionContext("event_original"),
    );

    await expect(
      decryptJson(
        encrypted,
        new Map([[1, key]]),
        eventEncryptionContext("event_different"),
      ),
    ).rejects.toThrow();
    await expect(
      decryptJson(
        encrypted,
        new Map([[1, key]]),
        stateEncryptionContext("cleaner_subject_original"),
      ),
    ).rejects.toThrow();
  });

  it("binds state ciphertext to its cleaner subject", async () => {
    const key = await importEncryptionKey(
      crypto.getRandomValues(new Uint8Array(32)),
    );
    const context = stateEncryptionContext("cleaner_subject_original");
    const encrypted = await encryptJson(
      { currentShift: null },
      key,
      2,
      context,
    );

    await expect(
      decryptJson(encrypted, new Map([[2, key]]), context),
    ).resolves.toEqual({ currentShift: null });
    await expect(
      decryptJson(
        encrypted,
        new Map([[2, key]]),
        stateEncryptionContext("cleaner_subject_different"),
      ),
    ).rejects.toThrow();
  });

  it("produces stable keyed digests for canonical event data", async () => {
    const key = await importHmacKey("synthetic-event-digest-material");
    const left = {
      eventType: "clock_in",
      submittedAtMs: 1_786_820_400_000,
      payload: { note: null, property: "synthetic-property" },
    };
    const right = {
      payload: { property: "synthetic-property", note: null },
      submittedAtMs: 1_786_820_400_000,
      eventType: "clock_in",
    };

    expect(await digestCanonicalEvent(left, key)).toBe(
      await digestCanonicalEvent(right, key),
    );
  });

  it("provides a non-truncating proposed note compatibility check", () => {
    const accepted = "x".repeat(1_000);
    const rejected = `${accepted}y`;

    expect(validateProposedNoteLimit(accepted)).toEqual({
      characterCount: 1_000,
      limit: 1_000,
      valid: true,
    });
    expect(validateProposedNoteLimit(rejected)).toEqual({
      characterCount: 1_001,
      limit: 1_000,
      valid: false,
    });
    expect(rejected).toHaveLength(1_001);
  });
});
/* end[relay_crypto_tests] */
