import fs from "node:fs/promises";
import path from "node:path";
import { Processor } from "../../../../src/queues/decorators/processor.js";

export const PROOF_FILE = path.join(process.cwd(), ".worker-proof.txt");

@Processor("email-welcome-queue", "io")
export class WelcomeWorkerProcessor {
  async handle(jobId: string, payload: any) {
    await fs.writeFile(
      PROOF_FILE,
      `Trabajo completado: ${payload._trackingId}`,
    );
    return { success: true, workerId: jobId };
  }
}
