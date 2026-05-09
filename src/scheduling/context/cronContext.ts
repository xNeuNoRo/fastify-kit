import { AlsStore } from "../../http/context/AlsStore.js";

export interface CronContext {
  cronId: string;
  jobName: string;
}

// Store exclusivo para el ciclo de vida de trabajos programados
export const cronContext = new AlsStore<CronContext>();
