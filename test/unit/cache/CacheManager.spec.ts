import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { Cache, ClearCache } from "../../../src/cache/cache.decorator.js";
import { CacheManager } from "../../../src/cache/CacheManager.js";

describe("Sistema de Caché (CacheManager, @Cache & @ClearCache)", () => {
  // Esto se ejecuta antes de cada "it" para asegurarnos de que el CacheManager esté limpio antes de cada prueba
  beforeEach(() => {
    CacheManager.clearAll();
    // Configuramos los timers falsos para simular expiración de caché sin esperar realmente
    vi.useFakeTimers();
  });

  afterEach(() => {
    // Restauramos el timer real después de cada test
    vi.useRealTimers();
  });

  describe("Operaciones Core y TTL (CacheManager)", () => {
    it("Deberia almacenar y recuperar datos sin expiración (Permanentes)", () => {
      const user = {
        id: 1,
        name: "Angel Gonzalez",
      };
      CacheManager.set("user:1", user);

      const retrievedUser = CacheManager.get<typeof user>("user:1");

      expect(retrievedUser).toBeDefined();
      expect(retrievedUser).toEqual(user);
      expect(retrievedUser?.id).toBe(1);
      expect(retrievedUser?.name).toBe("Angel Gonzalez");
    });

    it("Deberia expirar correctamente los datos basados en el TTL", () => {
      const token = "abc123";
      CacheManager.set("auth:token", token, 60); // TTL de 60 segundos

      // Avanzamos el tiempo 30 segundos, el token aún debería ser válido
      vi.advanceTimersByTime(30000);
      let retrievedToken = CacheManager.get<typeof token>("auth:token");

      expect(retrievedToken).toBeDefined();
      expect(retrievedToken).toEqual(token);
      expect(retrievedToken).toBe(token);

      // Avanzamos el tiempo otros 31 segundos (total 61 segundos), el token debería haber expirado
      vi.advanceTimersByTime(31000);
      retrievedToken = CacheManager.get<typeof token>("auth:token");

      expect(retrievedToken).toBeNull();
    });

    it("Deberia limpiar solo el namespace especificado", () => {
      CacheManager.set("users:1", "User 1");
      CacheManager.set("users:2", "User 2");
      CacheManager.set("config:theme", "dark");

      CacheManager.clearNamespace("users");

      const user1 = CacheManager.get<string>("users:1");
      const user2 = CacheManager.get<string>("users:2");
      const theme = CacheManager.get<string>("config:theme");

      expect(user1).toBeNull();
      expect(user2).toBeNull();
      expect(theme).toBe("dark");
    });

    it("Deberia evitar colisiones al limpiar namespaces con prefijos similares", () => {
      // Registramos dos namespaces que empiezan casi igual
      CacheManager.set("users:1", "User Normal");
      CacheManager.set("users_premium:1", "User VIP");

      // Limpiamos solo "users"
      CacheManager.clearNamespace("users");

      // Validamos la precision del del metodo clearNamespace
      expect(CacheManager.get("users:1")).toBeNull(); // Se borró
      expect(CacheManager.get("users_premium:1")).toBe("User VIP"); // No se borró porque el namespace es diferente
    });

    it("Deberia eliminar todos los namespaces correctamente", () => {
      CacheManager.set("users:1", "User 1");
      CacheManager.set("users:2", "User 2");
      CacheManager.set("config:theme", "dark");

      CacheManager.clearAll();

      const user1 = CacheManager.get<string>("users:1");
      const user2 = CacheManager.get<string>("users:2");
      const theme = CacheManager.get<string>("config:theme");

      expect(user1).toBeNull();
      expect(user2).toBeNull();
      expect(theme).toBeNull();
    });
  });

  describe("Decoradores de Caché (@Cache & @ClearCache)", () => {
    it("Deberia cachear respuestas sincronas y evitar re-ejecuciones innecesarias", () => {
      class MathService {
        public callCount = 0;

        @Cache("math")
        multiply(a: number, b: number): number {
          this.callCount++;
          return a * b;
        }
      }

      const service = new MathService();

      // Primera llamada, debería ejecutar el método
      const result1 = service.multiply(2, 3);
      expect(result1).toBe(6);
      expect(service.callCount).toBe(1);

      // Segunda llamada con los mismos argumentos, debería devolver el resultado cacheado sin ejecutar el método
      const result2 = service.multiply(2, 3);
      expect(result2).toBe(6);
      expect(service.callCount).toBe(1); // No incrementa porque se cacheó

      // Tercera llamada con diferentes argumentos, debería ejecutar el método nuevamente
      const result3 = service.multiply(4, 5);
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

    it("Deberia invalidar el cache asincrona correctamente usando @ClearCache", async () => {
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
      const cachedPost = CacheManager.get("posts:getPosts:[]");
      expect(cachedPost).toBeDefined();
      expect(cachedPost).toEqual(["post1"]);

      // Simulamos crear un post lo cual deberia invalidar el cache de getPosts
      await service.createPost();

      const cachedPostAfterInvalidation = CacheManager.get("posts:getPosts:[]");

      // La cache no deberia existir ya que fue invalidada por createPost
      expect(cachedPostAfterInvalidation).toBeNull();
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
      const cachedError = CacheManager.get("unreliable:fetchData:[true]");
      expect(cachedError).toBeNull();
      expect(service.callCount).toBe(1);

      // Segunda llamada con shouldFail=false, debería resolver correctamente y cachear el resultado
      const result = await service.fetchData(false);
      expect(result).toBe("Success");

      // Verificamos que el resultado se cacheó correctamente
      const cachedResult = CacheManager.get("unreliable:fetchData:[false]");
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

    it("Deberia cachear correctamente valores 'falsy' válidos (0, false, '') sin re-ejecutar el método", () => {
      class FalsyService {
        public callCount = 0;

        @Cache("falsy")
        getFalseFlag(): boolean {
          this.callCount++;
          return false;
        }

        @Cache("falsy")
        getZeroCount(): number {
          this.callCount++;
          return 0;
        }
      }

      const service = new FalsyService();

      // Ejecutamos y cacheamos
      expect(service.getFalseFlag()).toBe(false);
      expect(service.getZeroCount()).toBe(0);
      expect(service.callCount).toBe(2);

      // Segunda llamada: Deben retornar el valor Falsy desde la caché sin incrementar el contador
      expect(service.getFalseFlag()).toBe(false);
      expect(service.getZeroCount()).toBe(0);

      // La prueba definitiva de que no entraron en un falso negativo es que el contador no incrementó
      expect(service.callCount).toBe(2);
    });
  });
});
