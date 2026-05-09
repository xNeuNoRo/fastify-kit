import { AlsStore } from "../../http/context/AlsStore.js";

/**
 * @description Contrato interno para el almacenamiento de transacciones.
 */
export interface TransactionStore {
  isActive: boolean;
  /**
   * Instancia real de la base de datos (ej. el cliente de Prisma tx)
   * que se inyecta dinámicamente cuando la transacción inicia.
   */
  txInstance?: any;
}

/**
 * @description Store exclusivo para el manejo de transacciones de base de datos.
 */
export const transactionContext = new AlsStore<TransactionStore>();
