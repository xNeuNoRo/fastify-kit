import { describe, it, expect } from "vitest";

import type { CacheEnvelope } from "../../../../src/cache/interfaces/CacheAdapter.js";
import {
  CacheCodecError,
  decodeCacheEnvelope,
  encodeCacheEnvelope,
} from "../../../../src/cache/redis/CacheEnvelopeCodec.js";
import {
  decodeInvalidationMessage,
  encodeInvalidationMessage,
} from "../../../../src/cache/redis/CacheInvalidationCodec.js";

function makeEnvelope(overrides?: Partial<CacheEnvelope>): CacheEnvelope {
  return {
    value: { id: 1, name: "Angel" },
    namespaceVersion: 3,
    storedAt: 1_000,
    freshUntil: 61_000,
    staleUntil: 3_601_000,
    isNegative: false,
    ...overrides,
  };
}

describe("CacheEnvelopeCodec", () => {
  it("Debería hacer roundtrip de todos los campos del envelope", () => {
    const envelope = makeEnvelope();

    const raw = encodeCacheEnvelope(envelope);
    const decoded = decodeCacheEnvelope(raw);

    expect(decoded).toEqual(envelope);
  });

  it("Debería aceptar entradas frescas sin ventana stale", () => {
    const envelope = makeEnvelope({ staleUntil: null });

    expect(decodeCacheEnvelope(encodeCacheEnvelope(envelope))).toEqual(
      envelope,
    );
  });

  it("Debería persistir undefined como null (JSON no soporta undefined)", () => {
    const raw = encodeCacheEnvelope(makeEnvelope({ value: undefined }));

    const decoded = decodeCacheEnvelope(raw);
    expect(decoded.value).toBeNull();
  });

  it("Debería producir un formato estable y versionado", () => {
    const raw = encodeCacheEnvelope(makeEnvelope());

    const parsed = JSON.parse(raw) as Record<string, unknown>;
    expect(parsed._v).toBe(1);
    expect(Object.keys(parsed).sort()).toEqual([
      "_v",
      "freshUntil",
      "isNegative",
      "namespaceVersion",
      "staleUntil",
      "storedAt",
      "value",
    ]);
  });

  it("Debería rechazar JSON corrupto", () => {
    expect(() => decodeCacheEnvelope("not-json{")).toThrow(CacheCodecError);
  });

  it("Debería rechazar shapes incompatibles (otra versión de formato)", () => {
    const raw = encodeCacheEnvelope(makeEnvelope());
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    parsed._v = 2;

    expect(() => decodeCacheEnvelope(JSON.stringify(parsed))).toThrow(
      CacheCodecError,
    );
  });

  it("Debería rechazar shapes incompatibles (campos faltantes o mal tipados)", () => {
    const missing = '{"_v":1,"value":1}';
    const wrongType =
      '{"_v":1,"value":1,"namespaceVersion":"x","storedAt":1,"freshUntil":null,"staleUntil":null,"isNegative":false}';

    expect(() => decodeCacheEnvelope(missing)).toThrow(CacheCodecError);
    expect(() => decodeCacheEnvelope(wrongType)).toThrow(CacheCodecError);
  });

  it.each([
    ["namespaceVersion", { namespaceVersion: Number.NaN }],
    ["storedAt", { storedAt: Number.POSITIVE_INFINITY }],
    ["freshUntil", { freshUntil: Number.NaN }],
    ["staleUntil", { staleUntil: Number.NEGATIVE_INFINITY }],
    ["storedAt", { storedAt: Number.MAX_SAFE_INTEGER + 1 }],
  ])("Debería rechazar %s no finito al serializar", (_field, override) => {
    expect(() => encodeCacheEnvelope(makeEnvelope(override))).toThrow(
      CacheCodecError,
    );
  });

  it("Debería rechazar un TTL stale anterior al TTL fresh al deserializar", () => {
    const raw = JSON.stringify(
      makeEnvelope({ freshUntil: 61_000, staleUntil: 10_000 }),
    );

    expect(() => decodeCacheEnvelope(raw)).toThrow(CacheCodecError);
  });

  it("Debería aceptar valores JSON-compatibles (Date y Buffer)", () => {
    const envelope = makeEnvelope({
      value: { at: new Date("2024-01-01T00:00:00Z"), buf: Buffer.from("hi") },
    });

    const decoded = decodeCacheEnvelope(encodeCacheEnvelope(envelope));
    expect(decoded.value).toEqual({
      at: "2024-01-01T00:00:00.000Z",
      buf: { type: "Buffer", data: [104, 105] },
    });
  });

  it.each([
    ["Map", new Map([["a", 1]])],
    ["Set", new Set([1])],
    ["WeakMap", new WeakMap()],
    ["WeakSet", new WeakSet()],
    ["RegExp", /x/],
    ["Error", new Error("boom")],
    ["Promise", Promise.resolve(1)],
  ])("Debería rechazar %s (pérdida de datos silenciosa)", (_label, value) => {
    expect(() => encodeCacheEnvelope(makeEnvelope({ value }))).toThrow(
      CacheCodecError,
    );
  });

  it("Debería rechazar BigInt, funciones, símbolos y ciclos", () => {
    expect(() => encodeCacheEnvelope(makeEnvelope({ value: 10n }))).toThrow(
      CacheCodecError,
    );
    expect(() => encodeCacheEnvelope(makeEnvelope({ value: () => 1 }))).toThrow(
      CacheCodecError,
    );
    expect(() =>
      encodeCacheEnvelope(makeEnvelope({ value: Symbol("x") })),
    ).toThrow(CacheCodecError);

    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() =>
      encodeCacheEnvelope(makeEnvelope({ value: circular })),
    ).toThrow(CacheCodecError);
  });

  it("Debería rechazar números no finitos y undefined anidado", () => {
    expect(() =>
      encodeCacheEnvelope(makeEnvelope({ value: Number.NaN })),
    ).toThrow(CacheCodecError);
    expect(() =>
      encodeCacheEnvelope(makeEnvelope({ value: { amount: Infinity } })),
    ).toThrow(CacheCodecError);
    expect(() =>
      encodeCacheEnvelope(makeEnvelope({ value: { nested: undefined } })),
    ).toThrow(CacheCodecError);
  });

  it("Debería permitir referencias compartidas sin ciclo", () => {
    const shared = { role: "admin" };
    const value = { a: shared, b: shared };

    const decoded = decodeCacheEnvelope(
      encodeCacheEnvelope(makeEnvelope({ value })),
    );
    expect(decoded.value).toEqual({
      a: { role: "admin" },
      b: { role: "admin" },
    });
  });

  it("Debería incluir la ruta del campo problemático en el error", () => {
    expect(() =>
      encodeCacheEnvelope(
        makeEnvelope({ value: { user: { settings: new Map() } } }),
      ),
    ).toThrow(/user\.settings/);
  });
});

describe("CacheInvalidationCodec", () => {
  it("Debería hacer roundtrip de un mensaje con keys", () => {
    const message = {
      namespace: "users",
      namespaceVersion: 5,
      keys: ["users:1", "users:2"],
    };

    const decoded = decodeInvalidationMessage(
      encodeInvalidationMessage(message),
    );
    expect(decoded).toEqual(message);
  });

  it("Debería omitir keys vacíos del payload", () => {
    const raw = encodeInvalidationMessage({
      namespace: "users",
      namespaceVersion: 1,
    });

    const parsed = JSON.parse(raw) as Record<string, unknown>;
    expect(parsed.keys).toBeUndefined();
    expect(decodeInvalidationMessage(raw)).toEqual({
      namespace: "users",
      namespaceVersion: 1,
    });
  });

  it("Debería hacer roundtrip del sourceId y omitirlo cuando está ausente", () => {
    const withSource = {
      namespace: "users",
      namespaceVersion: 2,
      keys: ["users:1"],
      sourceId: "instance-abc",
    };
    expect(
      decodeInvalidationMessage(encodeInvalidationMessage(withSource)),
    ).toEqual(withSource);

    const withoutSource = {
      namespace: "users",
      namespaceVersion: 2,
    };
    expect(
      decodeInvalidationMessage(encodeInvalidationMessage(withoutSource)),
    ).toEqual(withoutSource);
  });

  it("Debería rechazar mensajes corruptos o con shape inválido", () => {
    expect(() => decodeInvalidationMessage("nope{")).toThrow(CacheCodecError);
    expect(() =>
      decodeInvalidationMessage(
        JSON.stringify({ namespace: "", namespaceVersion: 1 }),
      ),
    ).toThrow(CacheCodecError);
    expect(() =>
      decodeInvalidationMessage(
        JSON.stringify({ namespace: "users", namespaceVersion: "x" }),
      ),
    ).toThrow(CacheCodecError);
    expect(() =>
      decodeInvalidationMessage(
        JSON.stringify({ namespace: "users", namespaceVersion: 1, keys: [1] }),
      ),
    ).toThrow(CacheCodecError);
    expect(() =>
      decodeInvalidationMessage(
        JSON.stringify({ namespace: "users", namespaceVersion: Number.NaN }),
      ),
    ).toThrow(CacheCodecError);
    expect(() =>
      decodeInvalidationMessage(
        JSON.stringify({
          namespace: "users",
          namespaceVersion: 1,
          keys: ["orders:1"],
        }),
      ),
    ).toThrow(CacheCodecError);
    expect(() =>
      decodeInvalidationMessage(
        JSON.stringify({ namespace: "bad namespace", namespaceVersion: 1 }),
      ),
    ).toThrow(CacheCodecError);
    expect(() =>
      decodeInvalidationMessage(
        JSON.stringify({
          namespace: "*",
          namespaceVersion: 1,
          keys: ["bad\u0000key"],
        }),
      ),
    ).toThrow(CacheCodecError);
  });

  it("Debería rechazar mensajes de invalidación sobredimensionados", () => {
    expect(() =>
      decodeInvalidationMessage(
        JSON.stringify({
          namespace: "users",
          namespaceVersion: 1,
          keys: ["users:" + "x".repeat(4_100)],
        }),
      ),
    ).toThrow(CacheCodecError);
  });
});
