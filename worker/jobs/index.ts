import {
  createNotification,
  deleteNotification,
} from "../notifications/notifications";
import type { NotificationInput } from "../notifications/notifications";
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
    case "notification.create":
      if (!(await notificationExists(env, job.input))) {
        await deleteNotification(env, job.input.eventKey);
        return;
      }
      await createNotification(env, job.input);
      return;
    case "notification.delete":
      await deleteNotification(env, job.eventKey);
      return;
  }
}

async function notificationExists(
  env: Env,
  input: NotificationInput,
): Promise<boolean> {
  if (!input.actorId) return true;
  let query: string | null = null;
  let values: string[] = [];
  if (input.type === "like" && input.postId) {
    query = "SELECT 1 AS hit FROM likes WHERE user_id = ? AND post_id = ?";
    values = [input.actorId, input.postId];
  } else if (input.type === "repost" && input.postId) {
    query = "SELECT 1 AS hit FROM reposts WHERE user_id = ? AND post_id = ?";
    values = [input.actorId, input.postId];
  } else if (input.type === "follow") {
    query =
      "SELECT 1 AS hit FROM follows WHERE follower_id = ? AND followee_id = ?";
    values = [input.actorId, input.recipientId];
  } else if (input.type === "reply" && input.commentId) {
    query = "SELECT 1 AS hit FROM comments WHERE id = ? AND deleted_at IS NULL";
    values = [input.commentId];
  }
  if (!query) return true;
  return Boolean(
    await env.DB.prepare(query)
      .bind(...values)
      .first<{ hit: number }>(),
  );
}
