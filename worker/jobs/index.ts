import {
  createNotification,
  deleteNotification,
} from "../notifications/notifications";
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
    case "notification.follow.sync": {
      const active = await env.DB.prepare(
        `SELECT 1 FROM follows
         WHERE follower_id = ? AND followee_id = ?`,
      )
        .bind(job.followerId, job.recipientId)
        .first();
      if (!active) {
        await deleteNotification(env, job.eventKey);
        return;
      }
      await createNotification(env, {
        recipientId: job.recipientId,
        actorId: job.followerId,
        type: "follow",
        eventKey: job.eventKey,
      });
      return;
    }
    case "notification.post.sync": {
      const table = job.kind === "like" ? "likes" : "reposts";
      const active = await env.DB.prepare(
        `SELECT 1 FROM ${table} i
         JOIN posts p ON p.id = i.post_id
         WHERE i.user_id = ? AND i.post_id = ? AND p.deleted_at IS NULL`,
      )
        .bind(job.actorId, job.postId)
        .first();
      if (!active) {
        await deleteNotification(env, job.eventKey);
        return;
      }
      await createNotification(env, {
        recipientId: job.recipientId,
        actorId: job.actorId,
        type: job.kind,
        postId: job.postId,
        eventKey: job.eventKey,
      });
      return;
    }
    case "notification.reply.sync": {
      const active = await env.DB.prepare(
        `SELECT 1 FROM comments c
         JOIN posts p ON p.id = c.post_id
         WHERE c.id = ? AND c.post_id = ?
           AND c.deleted_at IS NULL AND p.deleted_at IS NULL`,
      )
        .bind(job.commentId, job.postId)
        .first();
      if (!active) {
        await deleteNotification(env, job.eventKey);
        return;
      }
      await createNotification(env, {
        recipientId: job.recipientId,
        actorId: job.actorId,
        type: "reply",
        postId: job.postId,
        commentId: job.commentId,
        eventKey: job.eventKey,
        data: { excerpt: job.excerpt },
      });
      return;
    }
  }
}
