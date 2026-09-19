import type { Env } from "./platform";

/**
 * 队列任务。只放「不进关键路径」的活：
 * 失败能重试、晚几秒做完也没关系的那些。
 */
export type Job = { type: "notification.welcome"; userId: string };

export async function enqueueJob(env: Env, job: Job): Promise<void> {
  await env.JOBS.send(job);
}

export interface QueueMessage<T> {
  id: string;
  body: T;
  ack(): void;
  retry(): void;
}

export interface QueueBatch<T> {
  queue: string;
  messages: QueueMessage<T>[];
}
