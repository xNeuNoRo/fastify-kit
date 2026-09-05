import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { Cache, ClearCache } from "../../../src/cache/cache.decorator.js";
import { getCacheAdapter } from "../../../src/cache/cache.factory.js";
import { CacheManager } from "../../../src/cache/CacheManager.js";
import { CacheKeySerializationError } from "../../../src/cache/errors.js";
import {
  CACHE_ADAPTER_TOKEN,
  type CacheAdapter,
} from "../../../src/cache/interfaces/CacheAdapter.js";
import {
  INTERNAL_CONFIG_SERVICE_TOKEN,
  type InternalConfigService,
} from "../../../src/config/InternalConfigService.js";
import { container } from "../../../src/container/DIContainer.js";
import {
  METRICS_SERVICE_TOKEN,
  type MetricsService,
} from "../../../src/observability/contracts/MetricsService.js";

describe("Sistema de Caché (CacheManager, @Cache & @ClearCache)", () => {
  // El setup global (test/setup.ts) ya limpia el contenedor antes de cada test,
  // por lo que cada test arranca con un adaptador fresco.
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("Operaciones Core y TTL (CacheManager)", () => {
    it("rechaza TTLs no finitos", async () => {
      await expect(
        CacheManager.set("users:invalid-ttl", "value", Infinity),
      ).rejects.toThrow("ttlSeconds");
    });

    it("Deberia almacenar y recuperar datos sin expiración (Permanentes)", async () => {
      const user = {
        id: 1,
        name: "Angel Gonzalez",
      };
      await CacheManager.set("user:1", user);

      const retrievedUser = await CacheManager.get<typeof user>("user:1");

      expect(retrievedUser).toBeDefined();
      expect(retrievedUser).toEqual(user);
      expect(retrievedUser?.id).toBe(1);
      expect(retrievedUser?.name).toBe("Angel Gonzalez");
    });

    it("Deberia expirar correctamente los datos basados en el TTL", async () => {
      const token = "abc123";
      await CacheManager.set("auth:token", token, 60); // TTL de 60 segundos

      // Avanzamos el tiempo 30 segundos, el token aún debería ser válido
      vi.advanceTimersByTime(30000);
      let retrievedToken = await CacheManager.get<typeof token>("auth:token");

      expect(retrievedToken).toBeDefined();
      expect(retrievedToken).toEqual(token);
      expect(retrievedToken).toBe(token);

      // Avanzamos el tiempo otros 31 segundos (total 61 segundos), el token debería haber expirado
      vi.advanceTimersByTime(31000);
      retrievedToken = await CacheManager.get<typeof token>("auth:token");

      expect(retrievedToken).toBeNull();
    });

    it("Deberia limpiar solo el namespace especificado", async () => {
      await CacheManager.set("users:1", "User 1");
      await CacheManager.set("users:2", "User 2");
      await CacheManager.set("config:theme", "dark");

      await CacheManager.clearNamespace("users");

      const user1 = await CacheManager.get<string>("users:1");
      const user2 = await CacheManager.get<string>("users:2");
      const theme = await CacheManager.get<string>("config:theme");

      expect(user1).toBeNull();
      expect(user2).toBeNull();
      expect(theme).toBe("dark");
    });

    it("Deberia evitar colisiones al limpiar namespaces con prefijos similares", async () => {
      // Registramos dos namespaces que empiezan casi igual
      await CacheManager.set("users:1", "User Normal");
      await CacheManager.set("users_premium:1", "User VIP");

      // Limpiamos solo "users"
      await CacheManager.clearNamespace("users");

      // Validamos la precision del del metodo clearNamespace
      expect(await CacheManager.get("users:1")).toBeNull(); // Se borró
      expect(await CacheManager.get("users_premium:1")).toBe("User VIP"); // No se borró porque el namespace es diferente
    });

    it("Deberia eliminar todos los namespaces correctamente", async () => {
      await CacheManager.set("users:1", "User 1");
      await CacheManager.set("users:2", "User 2");
      await CacheManager.set("config:theme", "dark");

      await CacheManager.clearAll();

      const user1 = await CacheManager.get<string>("users:1");
      const user2 = await CacheManager.get<string>("users:2");
      const theme = await CacheManager.get<string>("config:theme");

      expect(user1).toBeNull();
      expect(user2).toBeNull();
      expect(theme).toBeNull();
    });
  });

  it("rechaza TTLs no finitos en @Cache", () => {
    expect(() => Cache("users", Infinity)).toThrow("ttlSeconds");
  });

  describe("getOrLoad (CacheManager)", () => {
    it("Debería cargar con el loader en miss y servir de la caché después", async () => {
      const loader = vi.fn(() => Promise.resolve("fresh"));

      expect(await CacheManager.getOrLoad("users:1", loader)).toBe("fresh");
      expect(await CacheManager.getOrLoad("users:1", loader)).toBe("fresh");
      expect(loader).toHaveBeenCalledTimes(1);
      expect(await CacheManager.get("users:1")).toBe("fresh");
    });

    it("Debería propagar los errores del loader sin almacenarlos", async () => {
      const loader = vi.fn(() => Promise.reject(new Error("boom")));

      await expect(CacheManager.getOrLoad("users:1", loader)).rejects.toThrow(
        "boom",
      );
      expect(await CacheManager.get("users:1")).toBeNull();
    });

    it("Debería emular get-or-load con un adaptador custom (sin getOrLoad)", async () => {
      const store = new Map<string, unknown>();
      const customAdapter: CacheAdapter = {
        get: () => Promise.resolve(null),
        set: vi.fn((key: string, envelope: unknown) => {
          store.set(key, envelope);
          return Promise.resolve();
        }),
        delete: () => Promise.resolve(),
        clearNamespace: () => Promise.resolve(),
        clearAll: () => Promise.resolve(),
        getVersion: () => Promise.resolve(0),
        setVersion: () => Promise.resolve(),
      };
      container.registerInstance(CACHE_ADAPTER_TOKEN, customAdapter);

      const loader = vi.fn(() => Promise.resolve("custom-value"));

      expect(await CacheManager.getOrLoad("users:1", loader)).toBe(
        "custom-value",
      );
      expect(store.has("users:1")).toBe(true);
      expect(loader).toHaveBeenCalledTimes(1);
    });

    it("Debería coalescer llamadas concurrentes del mismo key (una sola carga)", async () => {
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const innerLoader = vi.fn(() => Promise.resolve("inner"));
      let innerCall!: Promise<string>;

      const loader = vi.fn(() => {
        // Llamada concurrente lanzada MIENTRAS la carga está en curso.
        innerCall = CacheManager.getOrLoad("users:1", innerLoader);
        return gate.then(() => "outer");
      });

      const p1 = CacheManager.getOrLoad("users:1", loader);
      await Promise.resolve(); // el loader arranca e inicia la llamada concurrente

      release();

      expect(await p1).toBe("outer");
      expect(await innerCall).toBe("outer"); // esperó el in-flight
      expect(loader).toHaveBeenCalledTimes(1);
      expect(innerLoader).not.toHaveBeenCalled();
    });
  });

  describe("Decoradores de Caché (@Cache & @ClearCache)", () => {
    it("Deberia cachear respuestas que retornan Promise y evitar re-ejecuciones innecesarias", async () => {
      class MathService {
        public callCount = 0;

        @Cache("math")
        multiply(a: number, b: number): Promise<number> {
          this.callCount++;
          return Promise.resolve(a * b);
        }
      }

      const service = new MathService();

      // Primera llamada, debería ejecutar el método
      const result1 = await service.multiply(2, 3);
      expect(result1).toBe(6);
      expect(service.callCount).toBe(1);

      // Segunda llamada con los mismos argumentos, debería devolver el resultado cacheado sin ejecutar el método
      const result2 = await service.multiply(2, 3);
      expect(result2).toBe(6);
      expect(service.callCount).toBe(1); // No incrementa porque se cacheó

      // Tercera llamada con diferentes argumentos, debería ejecutar el método nuevamente
      const result3 = await service.multiply(4, 5);
      expect(result3).toBe(20);
      expect(service.callCount).toBe(2); // Incrementa porque es un nuevo resultado
    });

    it("Deberia cachear respuestas asincronas y manejar correctamente las promesas", async () => {
      class DatabaseService {
        public callCount = 0;

        @Cache("user", 60)
        async getUser() {
          this.callCount++;
          return Promise.resolve({
            id: 1,
            name: "Angel Gonzalez",
          });
        }
      }

      const db = new DatabaseService();

      // Primera llamada, debería ejecutar el método y cachear la promesa
      const user1 = await db.getUser();
      // Segunda llamada, debería devolver el resultado cacheado sin ejecutar el método
      const user2 = await db.getUser();

      expect(user1).toBeDefined();
      expect(user2).toBeDefined();
      expect(user1).toEqual(user2);
      expect(user1.id).toBe(1);
      expect(user1.name).toBe("Angel Gonzalez");
      expect(db.callCount).toBe(1); // Solo se ejecuta una vez

      vi.advanceTimersByTime(61000); // Avanzamos el tiempo para que el cache expire

      // Tercera llamada después de la expiración, debería ejecutar el método nuevamente
      const user3 = await db.getUser();
      expect(user3).toBeDefined();
      expect(user3).toEqual(user1);
      expect(user3.id).toBe(1);
      expect(user3.name).toBe("Angel Gonzalez");
      expect(db.callCount).toBe(2); // Incrementa porque el cache expiró previamente
    });

    it("Debería compartir una única ejecución en llamadas concurrentes con miss", async () => {
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });

      class ConcurrentService {
        public callCount = 0;
        public inner!: Promise<string>;

        @Cache("concurrent")
        fetch(): Promise<string> {
          this.callCount++;
          // Llamada concurrente al mismo key mientras esta carga está en curso.
          this.inner = CacheManager.getOrLoad("concurrent:fetch:[]", () =>
            Promise.resolve("inner"),
          );
          return gate.then(() => "data");
        }
      }

      const service = new ConcurrentService();

      const p1 = service.fetch();
      await Promise.resolve(); // la ejecución arranca e inicia la llamada concurrente

      release();

      expect(await p1).toBe("data");
      expect(await service.inner).toBe("data"); // esperó el in-flight
      expect(service.callCount).toBe(1);
    });

    it("Debería invalidar el cache asincrona correctamente usando @ClearCache", async () => {
      class PostService {
        @Cache("posts")
        async getPosts() {
          return Promise.resolve(["post1"]);
        }

        @ClearCache("posts")
        async createPost() {
          return Promise.resolve(true);
        }
      }

      const service = new PostService();

      // Obtenemos los posts lo cual deberia cachear el resultado
      await service.getPosts();
      const cachedPost = await CacheManager.get("posts:getPosts:[]");
      expect(cachedPost).toBeDefined();
      expect(cachedPost).toEqual(["post1"]);

      // Simulamos crear un post lo cual deberia invalidar el cache de getPosts
      await service.createPost();

      const cachedPostAfterInvalidation =
        await CacheManager.get("posts:getPosts:[]");

      // La cache no deberia existir ya que fue invalidada por createPost
      expect(cachedPostAfterInvalidation).toBeNull();
    });

    it("Debería NO invalidar la caché si el método @ClearCache falla", async () => {
      class FailingClearService {
        @Cache("posts")
        async getPosts() {
          return Promise.resolve(["post1"]);
        }

        @ClearCache("posts")
        async updatePost() {
          return Promise.reject(new Error("update failed"));
        }
      }

      const service = new FailingClearService();

      await service.getPosts();
      await expect(service.updatePost()).rejects.toThrow("update failed");

      // La invalidación NO se ejecutó: los datos siguen servibles.
      expect(await CacheManager.get("posts:getPosts:[]")).toEqual(["post1"]);
    });

    it("Debería componerse con otros decorators Stage 3 sin romper la semántica", async () => {
      function CountCalls() {
        return function <This, Args extends unknown[], Return>(
          target: (this: This, ...args: Args) => Return,
          _context: ClassMethodDecoratorContext<
            This,
            (this: This, ...args: Args) => Return
          >,
        ) {
          return function (this: This, ...args: Args): Return {
            const instance = this as This & { outerCalls?: number };
            instance.outerCalls = (instance.outerCalls ?? 0) + 1;
            return target.apply(this, args);
          };
        };
      }

      class ComposedService {
        public callCount = 0;

        @CountCalls()
        @Cache("composed")
        fetch(id: number): Promise<string> {
          this.callCount++;
          return Promise.resolve(`value-${id}`);
        }
      }

      const service = new ComposedService();

      expect(await service.fetch(1)).toBe("value-1");
      expect(await service.fetch(1)).toBe("value-1");
      expect(service.callCount).toBe(1); // una sola ejecución real (cacheada)
      expect((service as unknown as { outerCalls?: number }).outerCalls).toBe(
        2,
      ); // el decorator exterior ve ambas invocaciones
    });

    it("Debería manejar correctamente errores en métodos cacheados sin almacenar resultados fallidos", async () => {
      class UnreliableService {
        public callCount = 0;

        @Cache("unreliable")
        async fetchData(shouldFail: boolean) {
          this.callCount++;
          if (shouldFail) {
            return Promise.reject(new Error("Fetch failed"));
          }
          return Promise.resolve("Success");
        }
      }

      const service = new UnreliableService();

      // Primera llamada con shouldFail=true, debería rechazar la promesa y no cachear el error
      await expect(service.fetchData(true)).rejects.toThrow("Fetch failed");

      // Verificamos que el error no se cacheó, por lo que la siguiente llamada con shouldFail=true debería intentar ejecutar el método nuevamente
      const cachedError = await CacheManager.get("unreliable:fetchData:[true]");
      expect(cachedError).toBeNull();
      expect(service.callCount).toBe(1);

      // Segunda llamada con shouldFail=false, debería resolver correctamente y cachear el resultado
      const result = await service.fetchData(false);
      expect(result).toBe("Success");

      // Verificamos que el resultado se cacheó correctamente
      const cachedResult = await CacheManager.get(
        "unreliable:fetchData:[false]",
      );
      expect(cachedResult).toBe("Success");
      expect(service.callCount).toBe(2);

      // Tercera llamada con shouldFail=false, debería devolver el resultado cacheado sin ejecutar el método nuevamente
      const resultCached = await service.fetchData(false);
      expect(resultCached).toBe("Success");
      expect(service.callCount).toBe(2);
    });
  });

  describe("Validaciones de Entorno", () => {
    it("Debería lanzar un error si @Cache se aplica a algo que no es un método", () => {
      expect(() => {
        class InvalidUsage {
          declare public dummy: unknown;
          constructor() {
            const cacheFn = Cache("test");
            cacheFn(
              undefined as unknown as (
                this: unknown,
                ...args: any[]
              ) => unknown,
              { kind: "field", name: "bad" } as any,
            );
          }
        }
        new InvalidUsage();
      }).toThrow();
    });

    it("Debería lanzar un error si @ClearCache se aplica a algo que no es un método", () => {
      expect(() => {
        class InvalidUsage {
          declare public dummy: unknown;
          constructor() {
            const clearFn = ClearCache("test");
            clearFn(
              undefined as unknown as (
                this: unknown,
                ...args: any[]
              ) => unknown,
              { kind: "field", name: "bad" } as any,
            );
          }
        }
        new InvalidUsage();
      }).toThrow();
    });

    it("Deberia cachear correctamente valores 'falsy' válidos (0, false, '') sin re-ejecutar el método", async () => {
      class FalsyService {
        public callCount = 0;

        @Cache("falsy")
        getFalseFlag(): Promise<boolean> {
          this.callCount++;
          return Promise.resolve(false);
        }

        @Cache("falsy")
        getZeroCount(): Promise<number> {
          this.callCount++;
          return Promise.resolve(0);
        }
      }

      const service = new FalsyService();

      // Ejecutamos y cacheamos
      expect(await service.getFalseFlag()).toBe(false);
      expect(await service.getZeroCount()).toBe(0);
      expect(service.callCount).toBe(2);

      // Segunda llamada: Deben retornar el valor Falsy desde la caché sin incrementar el contador
      expect(await service.getFalseFlag()).toBe(false);
      expect(await service.getZeroCount()).toBe(0);

      // La prueba definitiva de que no entraron en un falso negativo es que el contador no incrementó
      expect(service.callCount).toBe(2);
    });

    it("Deberia generar claves deterministas y rechazar referencias circulares", async () => {
      class KeyService {
        public callCount = 0;

        @Cache("serializer")
        read(_input: Record<string, unknown>): Promise<number> {
          this.callCount++;
          return Promise.resolve(this.callCount);
        }
      }

      const service = new KeyService();
      expect(await service.read({ b: 2, a: 1 })).toBe(1);
      expect(await service.read({ a: 1, b: 2 })).toBe(1);
      expect(service.callCount).toBe(1);

      const circular: Record<string, unknown> = {};
      circular.self = circular;
      expect(() => service.read(circular)).toThrow(CacheKeySerializationError);
    });
  });

  describe("Factory de caché (getCacheAdapter)", () => {
    it("Debería resolver la misma instancia en llamadas consecutivas", async () => {
      const first = await getCacheAdapter();
      const second = await getCacheAdapter();

      expect(first).toBe(second);
    });

    it("Debería respetar un CACHE_ADAPTER_TOKEN custom registrado", async () => {
      const customAdapter: CacheAdapter = {
        get: () => Promise.resolve(null),
        set: () => Promise.resolve(),
        delete: () => Promise.resolve(),
        clearNamespace: () => Promise.resolve(),
        clearAll: () => Promise.resolve(),
        getVersion: () => Promise.resolve(0),
        setVersion: () => Promise.resolve(),
      };
      container.registerInstance(CACHE_ADAPTER_TOKEN, customAdapter);

      expect(await getCacheAdapter()).toBe(customAdapter);
    });

    it("Debería fallar con error accionable si el modo requiere Redis sin configuración", async () => {
      const internalConfig = container.resolve<InternalConfigService>(
        INTERNAL_CONFIG_SERVICE_TOKEN,
      );
      internalConfig.set("distributed", {
        features: { cache: { mode: "multi" } },
      });

      await expect(getCacheAdapter()).rejects.toThrow(/l1-only/);
    });

    it("Debería reportar métricas de caché si METRICS_SERVICE_TOKEN está registrado", async () => {
      const metricsService = {
        increment: vi.fn(),
        histogram: vi.fn(),
      };
      container.registerInstance(
        METRICS_SERVICE_TOKEN,
        metricsService as unknown as MetricsService,
      );

      const loader = vi.fn(() => Promise.resolve("value"));
      await CacheManager.getOrLoad("metrics:key", loader);

      expect(metricsService.increment).toHaveBeenCalledWith(
        "cache_read_total",
        { result: "miss" },
      );
      expect(metricsService.histogram).toHaveBeenCalledWith(
        "cache_loader_duration_seconds",
        expect.any(Number),
      );
    });
  });
});
