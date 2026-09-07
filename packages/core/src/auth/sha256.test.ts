import { describe, expect, it } from "vitest";
import { hmacSha256Bytes, pbkdf2Sha256Bytes, sha256Bytes } from "./sha256";

function bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function hex(value: Uint8Array): string {
  return [...value].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

describe("dependency-free SHA-256 helpers", () => {
  it("matches SHA-256 and HMAC-SHA256 test vectors", () => {
    expect(hex(sha256Bytes(bytes("abc")))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(hex(hmacSha256Bytes(bytes("key"), bytes("The quick brown fox jumps over the lazy dog")))).toBe(
      "f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8",
    );
  });

  it("matches RFC 6070-style PBKDF2-SHA256 vectors", () => {
    expect(hex(pbkdf2Sha256Bytes(bytes("password"), bytes("salt"), 1))).toBe(
      "120fb6cffcf8b32c43e7225256c4f837a86548c92ccc35480805987cb70be17b",
    );
    expect(hex(pbkdf2Sha256Bytes(bytes("password"), bytes("salt"), 2))).toBe(
      "ae4d0c95af6b46d32d0adff928f06dd02a303f8ef3c251dfd6e2d85a95474c43",
    );
  });

  it("reproduces the Huawei client proof fixture", () => {
    const salt = Uint8Array.from(
      "00112233445566778899aabbccddeeff".match(/../g)!,
      (part) => Number.parseInt(part, 16),
    );
    const saltedPassword = pbkdf2Sha256Bytes(bytes("fixture-password"), salt, 2);
    const clientKey = hmacSha256Bytes(bytes("Client Key"), saltedPassword);
    const storedKey = sha256Bytes(clientKey);
    const signature = hmacSha256Bytes(
      bytes("fixture-first-nonce,fixture-server-nonce,fixture-server-nonce"),
      storedKey,
    );
    const proof = clientKey.map((value, index) => value ^ signature[index]!);
    expect(hex(proof)).toBe("4bf9e10519eeaf39ef850ca4070fd4896b939235c3833f26d45551fbde7b7cc8");
  });
});
