import { describe, it, expect } from "vitest";
import { Mapper } from "../../../src/utils/Mapper.js";
import { MapTo } from "../../../src/utils/map-to.decorator.js";

// Clases Dummys para pruebas
class UserEntity {
  name: string = "Default Name";
  age: number = 0;

  isAdult(): boolean {
    return this.age >= 18;
  }
}

class UserWithConstructor {
  name: string;
  constructor(name: string) {
    this.name = name;
  }
  greet() {
    return `Hola, ${this.name}`;
  }
}
describe("Sistema de Mapeo de Datos (Mapper & @MapTo)", () => {
  describe("Clase Mapper (Operaciones de Parcheo e Instanciación)", () => {
    it("Mapper.patch - Deberia actualizar solo las propiedades definidas en el source", () => {
      const target = new UserEntity();
      target.name = "Angel";
      target.age = 20;

      // El source solo tiene 'age', y explicitamente enviamos un undefined que debe ser ignorado
      const source = { age: 25, ignoreMe: undefined };

      Mapper.patch(target, source as any);

      expect(target).toBeInstanceOf(UserEntity); // Sigue siendo la misma instancia
      expect(target.name).toBe("Angel"); // No se tocó
      expect(target.age).toBe(25); // Se actualizó
      expect((target as any).ignoreMe).toBeUndefined(); // El undefined fue ignorado
    });

    it("Mapper.patch - Deberia devolver el target intacto si el source es null o undefined", () => {
      const target = { id: 1 };

      expect(Mapper.patch(target, null)).toEqual({ id: 1 });
      expect(Mapper.patch(target, undefined)).toEqual({ id: 1 });
    });

    it("Mapper.to - Deberia instanciar una clase y asignarle los valores", () => {
      const rawData = { name: "Neunoro", age: 30 };

      const user = Mapper.to(UserEntity, rawData);

      expect(user).toBeInstanceOf(UserEntity);
      expect(user.name).toBe("Neunoro");
      expect(user.age).toBe(30);
      expect(user.isAdult()).toBe(true); // Verificamos que los metodos sigan iguales
    });

    it("Mapper.toArray - Deberia mapear un array de objetos planos a instancias", () => {
      const rawArray = [
        { name: "Angel", age: 25 },
        { name: "Junior", age: 15 },
      ];

      const users = Mapper.toArray(UserEntity, rawArray);

      expect(users).toHaveLength(2);
      expect(users[0]).toBeInstanceOf(UserEntity);
      expect(users[0].isAdult()).toBe(true);
      expect(users[1]).toBeInstanceOf(UserEntity);
      expect(users[1].isAdult()).toBe(false);
    });

    it("Mapper.toArray - Deberia manejar inputs inválidos retornando un array vacío", () => {
      expect(Mapper.toArray(UserEntity, null as any)).toEqual([]);
      expect(Mapper.toArray(UserEntity, undefined as any)).toEqual([]);
      expect(Mapper.toArray(UserEntity, [])).toEqual([]);
    });

    it("Mapper.toArray - Deberia mapear correctamente incluso si el array contiene objetos con propiedades adicionales", () => {
      const rawArray = [
        { name: "Angel", age: 25, extra: "something" },
        { name: "Junior", age: 15, extra: "something too" },
      ];

      /*
       * NOTA (Por qué el Mapper permite propiedades extra):
       * * Este test valida que el Mapper tiene un comportamiento "Lax" (relajado) por diseño.
       * * Si intentáramos hacer un Mapper "estricto" iterando sobre Object.keys(target),
       * el comportamiento del framework dependería peligrosamente del tsconfig.json del usuario
       * (específicamente de la bandera `useDefineForClassFields`).
       * * En configuraciones legacy, `email: string;` no se emite en JS, haciéndola invisible.
       * * En TS moderno sí se emite (como undefined), PERO si el desarrollador usa `declare email: string;`
       * (un patrón vital para ORMs), la propiedad vuelve a ser invisible en tiempo de ejecución.
       * * Para garantizar determinismo absoluto, el Mapper copia los datos basándose en el source.
       * La responsabilidad de eliminar datos basura (Stripping) se delega a la capa de validación (@Validate o otra impl. del usuario).
       */
      const users = Mapper.toArray(UserEntity, rawArray);

      expect(users).toHaveLength(2);
      expect(users[0]).toBeInstanceOf(UserEntity);
      expect(users[0].name).toBe("Angel");
      expect(users[0].age).toBe(25);
      expect(users[1]).toBeInstanceOf(UserEntity);
      expect(users[1].name).toBe("Junior");
      expect(users[1].age).toBe(15);
      expect((users[0] as any).extra).toBe("something"); // La propiedad extra se asigna pero no es parte de UserEntity
      expect((users[1] as any).extra).toBe("something too");
    });

    it("Mapper.infer - Deberia devolver exactamente el mismo valor (Solo casteo de tipos TS)", () => {
      const obj = { data: true };
      const inferred = Mapper.infer<typeof obj>(obj);
      expect(inferred).toBe(obj); // Comparamos la misma referencia de memoria
      expect(inferred).toEqual(obj); // El contenido deberia ser igual
    });

    it("Mapper.infer - Deberia funcionar con cualquier tipo de dato primitivo", () => {
      const num = 42;
      const str = "Hello";
      const arr = [1, 2, 3];
      const obj = { key: "value" };

      expect(Mapper.infer<typeof num>(num)).toBe(num);
      expect(Mapper.infer<typeof num>(num)).toEqual(42);
      expect(Mapper.infer<typeof str>(str)).toBe(str);
      expect(Mapper.infer<typeof str>(str)).toEqual("Hello");
      expect(Mapper.infer<typeof arr>(arr)).toBe(arr);
      expect(Mapper.infer<typeof arr>(arr)).toEqual([1, 2, 3]);
      expect(Mapper.infer<typeof obj>(obj)).toBe(obj);
      expect(Mapper.infer<typeof obj>(obj)).toEqual({ key: "value" });
    });
  });

  describe("Decorador @MapTo", () => {
    it("Deberia mapear una respuesta sincrona (Objeto único) saltándose el constructor", () => {
      class Service {
        @MapTo(UserWithConstructor)
        getUser() {
          // Usamos el Mapper.infer ya que aun los decoradores no pueden inferir el tipo de retorno,
          // y esto es solo para ayudar a TS a entender que el retorno es UserWithConstructor
          return Mapper.infer<UserWithConstructor>({ name: "Carlos" });
        }
      }

      const service = new Service();
      const result = service.getUser();

      expect(result).toBeInstanceOf(UserWithConstructor);
      expect(result.name).toBe("Carlos");
      // Verificamos que hayamos heredado todos los metodos
      expect(result.greet()).toBe("Hola, Carlos");
    });

    it("Deberia mapear una respuesta sincrona (Array de objetos)", () => {
      class Service {
        @MapTo(UserEntity)
        getUsers() {
          // Usamos el Mapper.infer ya que aun los decoradores no pueden inferir el tipo de retorno,
          // y esto es solo para ayudar a TS a entender que el retorno es UserEntity[]
          return Mapper.infer<UserEntity[]>([
            { name: "User 1", age: 20 },
            { name: "User 2", age: 10 },
          ]);
        }
      }

      const result = new Service().getUsers();

      expect(Array.isArray(result)).toBe(true);
      expect(result[0]).toBeInstanceOf(UserEntity);
      expect(result[0].name).toBe("User 1");
      expect(result[0].isAdult()).toBe(true);
      expect(result[1]).toBeInstanceOf(UserEntity);
      expect(result[1].name).toBe("User 2");
      expect(result[1].isAdult()).toBe(false);
    });

    it("Deberia mapear una respuesta asíncrona (Promesa)", async () => {
      class AsyncService {
        @MapTo(UserEntity)
        async getUserAsync() {
          return Promise.resolve(
            Mapper.infer<UserEntity>({ name: "Async User", age: 35 }),
          );
        }
      }

      const result = await new AsyncService().getUserAsync();

      expect(result).toBeInstanceOf(UserEntity);
      expect(result.name).toBe("Async User");
      expect(result.isAdult()).toBe(true);
    });

    it("Deberia manejar correctamente respuestas nulas o vacías sin explotar", () => {
      class NullService {
        @MapTo(UserEntity)
        getNull() {
          return null;
        }

        @MapTo(UserEntity)
        getUndefined() {
          return undefined;
        }
      }

      const service = new NullService();

      expect(service.getNull()).toBeNull();
      expect(service.getUndefined()).toBeUndefined();
    });

    it("Debería lanzar un error si se aplica a algo que no sea un método", () => {
      expect(() => {
        class InvalidUsage {
          declare public dummy: unknown;
          constructor() {
            const mapFn = MapTo(UserEntity);
            mapFn(undefined as any, { kind: "field", name: "bad" } as any);
          }
        }
        new InvalidUsage();
      }).toThrow();
    });
  });
});
