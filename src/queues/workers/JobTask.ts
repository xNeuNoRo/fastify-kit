export interface JobTask<TResult = unknown> {
  jobId: string;
  queueName: string;
  payload: unknown;
  resolve: (value: TResult | PromiseLike<TResult>) => void;
  reject: (reason?: Error) => void;
}
