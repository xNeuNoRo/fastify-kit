import { describe, it, expect, beforeEach } from "vitest";

import { InMemoryCacheAdapter } from "../../../src/cache/adapters/InMemoryCacheAdapter.js";
import type { CacheEnvelope } from "../../../src/cache/interfaces/CacheAdapter.js";
import { createCacheEnvelope } from "../../../src/cache/interfaces/CacheResult.js";

function makeEnvelope<T>(
  value: T,
  overrides?: Partial<Parameters<typeof createCacheEnvelope<T>>[0]>,
): CacheEnvelope<T> {
  return createCacheEnvelope<T>({
    value,
    namespaceVersion: 0,
    freshTtlMs: 60_000,
    ...overrides,
  });
}

describe("InMemoryCacheAdapter (L1)", () => {
  let adapter: InMemoryCacheAdapter;

  beforeEach(() => {
    adapter = new InMemoryCacheAdapter({ maxSize: 100 });
  });

  it("Debería almacenar y recuperar envelopes", async () => {
    const envelope = makeEnvelope({ id: 1 });

    await adapter.set("user:1", envelope);

    const result = await adapter.get<{ id: number }>("user:1");
    expect(result).not.toBeNull();
    expect(result?.value).toEqual({ id: 1 });
    expect(result?.namespaceVersion).toBe(0);
  });

  it("Debería devolver null para claves inexistentes", async () => {
    expect(await adapter.get("missing")).toBeNull();
  });

  it("Debería eliminar claves con delete", async () => {
    await adapter.set("user:1", makeEnvelope("data"));

    await adapter.delete("user:1");

    expect(await adapter.get("user:1")).toBeNull();
  });

  it("Debería expirar entradas cuyo freshUntil ya venció y eliminarlas", async () => {
    const expired = makeEnvelope("old", {
      storedAt: Date.now() - 61_000,
      freshTtlMs: 60_000,
    });
    await adapter.set("user:1", expired);

    expect(await adapter.get("user:1")).toBeNull();
    expect(await adapter.get("user:1")).toBeNull(); // ya eliminada
  });

  it("Debería mantener vivas las entradas permanentes", async () => {
    const permanent = makeEnvelope("forever", {
      storedAt: Date.now() - 1_000_000,
      freshTtlMs: null,
    });
    await adapter.set("user:1", permanent);

    expect(await adapter.get("user:1")).not.toBeNull();
  });

  it("Debería expulsar la entrada menos reciente cuando supera maxSize", async () => {
    adapter = new InMemoryCacheAdapter({ maxSize: 2 });

    await adapter.set("a", makeEnvelope(1));
    await adapter.set("b", makeEnvelope(2));
    await adapter.set("c", makeEnvelope(3));

    expect(await adapter.get("a")).toBeNull();
    expect(await adapter.get("b")).not.toBeNull();
    expect(await adapter.get("c")).not.toBeNull();
  });

  it("Debería considerar el acceso reciente en la expulsión LRU", async () => {
    adapter = new InMemoryCacheAdapter({ maxSize: 2 });

    await adapter.set("a", makeEnvelope(1));
    await adapter.set("b", makeEnvelope(2));
    await adapter.get("a"); // "a" pasa a ser la más reciente

    await adapter.set("c", makeEnvelope(3));

    expect(await adapter.get("b")).toBeNull(); // "b" fue la menos reciente
    expect(await adapter.get("a")).not.toBeNull();
  });

  it("Debería limpiar solo el namespace exacto (sin colisiones de prefijo)", async () => {
    await adapter.set("users:1", makeEnvelope("User Normal"));
    await adapter.set("users_premium:1", makeEnvelope("User VIP"));

    await adapter.clearNamespace("users");

    expect(await adapter.get("users:1")).toBeNull();
    expect(await adapter.get("users_premium:1")).not.toBeNull();
  });

  it("Debería invalidar envelopes con versión anterior tras clearNamespace", async () => {
    await adapter.set("users:1", makeEnvelope("v0"));
    await adapter.clearNamespace("users");

    expect(await adapter.getVersion("users")).toBe(1);

    // Escritura concurrente con versión obsoleta: debe tratarse como miss.
    await adapter.set("users:1", makeEnvelope("stale-write"));

    expect(await adapter.get("users:1")).toBeNull();
  });

  it("Debería resetear store y versiones con clearAll", async () => {
    await adapter.set("users:1", makeEnvelope("data"));
    await adapter.clearNamespace("users");
    expect(await adapter.getVersion("users")).toBe(1);

    await adapter.clearAll();

    expect(await adapter.get("users:1")).toBeNull();
    expect(await adapter.getVersion("users")).toBe(1);
  });

  it("Debería devolver versión 0 para namespaces nunca versionados", async () => {
    expect(await adapter.getVersion("unknown")).toBe(0);
  });

  it("Debería sincronizar versiones de forma monotónica (nunca bajar)", async () => {
    await adapter.setVersion("users", 5);
    expect(await adapter.getVersion("users")).toBe(5);

    await adapter.setVersion("users", 3); // mensaje fuera de orden
    expect(await adapter.getVersion("users")).toBe(5);
  });

  it("Debería invalidar envelopes anteriores a una versión sincronizada", async () => {
    await adapter.set("users:1", makeEnvelope("v0"));
    await adapter.setVersion("users", 2);

    expect(await adapter.get("users:1")).toBeNull();
  });

  it("Debería usar la clave completa como namespace cuando no hay separador", async () => {
    await adapter.set("solo", makeEnvelope(1));

    expect(await adapter.getVersion("solo")).toBe(0);
    expect(await adapter.get("solo")).not.toBeNull();
  });
});
