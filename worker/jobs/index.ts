import { createNotification } from "../notifications/notifications";
import type { Job, QueueBatch } from "../shared/jobs";
import type { Env } from "../shared/platform";

export async function handleQueue(
  batch: QueueBatch<Job>,
  env: Env,
): Promise<void> {
  for (const message of batch.messages) {
    try {
      await runJob(env, message.body);
      message.ack();
    } catch (error) {
      console.error("Queue job failed", message.body, error);
      message.retry();
    }
  }
}

async function runJob(env: Env, job: Job): Promise<void> {
  switch (job.type) {
    case "notification.welcome":
      await createNotification(env, {
        recipientId: job.userId,
        type: "system",
        eventKey: `system:welcome:${job.userId}`,
        data: {
          title: "欢迎来到 FuckXter",
          body: "账号已就绪，完善资料就可以开始了。",
        },
      });
      return;
  }
}
