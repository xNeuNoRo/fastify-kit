import { Processor } from "../../../../src/queues/decorators/processor.js";

@Processor("distributed-test-queue")
export class DistributedProcessor {
  async handle(jobId: string, data: any) {
    return { processed: true, data, jobId };
  }
}
