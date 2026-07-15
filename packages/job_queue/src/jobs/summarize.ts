export {
  make_summarize_queues,
  register_summarizer,
  register_summarize_sweep,
  enqueue_summarize_job,
  schedule_summarize_sweep,
}
export type {
  SummarizeChatJob,
  SummarizeChatWorker,
  SummarizeSweepWorker,
}

import type PgBoss from "pg-boss";

// Chat summarization. Two queues:
//   * summarize_chat -- one durable, retriable unit of work per chat. Producers
//     are the per-turn nudge and the sweep below.
//   * summarize_sweep -- a periodic tick whose worker re-scans
//     for stale chats and enqueues summarize_chat jobs.

interface SummarizeChatJob {
  chat_id: string;
  user_id: string;
}

type SummarizeChatWorker = (jobs: PgBoss.Job<SummarizeChatJob>[]) => Promise<void>;
type SummarizeSweepWorker = (jobs: PgBoss.Job<object>[]) => Promise<void>;

async function make_summarize_queues(boss: PgBoss): Promise<void> {
  await boss.createQueue(
    _QUEUE_SUMMARIZE_CHAT, { name: _QUEUE_SUMMARIZE_CHAT, policy: "short" });
  await boss.createQueue(_QUEUE_SUMMARIZE_SWEEP);
}

async function register_summarizer(boss: PgBoss, worker: SummarizeChatWorker): Promise<void> {
  await boss.work<SummarizeChatJob>(_QUEUE_SUMMARIZE_CHAT, worker);
}

async function register_summarize_sweep(boss: PgBoss, worker: SummarizeSweepWorker): Promise<void> {
  await boss.work(_QUEUE_SUMMARIZE_SWEEP, worker);
}

async function enqueue_summarize_job(boss: PgBoss, job: SummarizeChatJob): Promise<void> {
  // singletonKey collapses rapid turns on the same chat (the nudge) and a sweep
  // re-enqueue into a single pending job, so a busy chat is summarized once per
  // drain, not once per turn.
  await boss.send(_QUEUE_SUMMARIZE_CHAT, job, { singletonKey: job.chat_id });
}

async function schedule_summarize_sweep(boss: PgBoss, cron: string): Promise<void> {
  await boss.schedule(_QUEUE_SUMMARIZE_SWEEP, cron);
}

const _QUEUE_SUMMARIZE_CHAT = "summarize_chat";
const _QUEUE_SUMMARIZE_SWEEP = "summarize_sweep";
