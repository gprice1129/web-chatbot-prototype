export { type PgBoss, ParseFileWorker, ParseFileJob, run_PgBoss, make_parse_queue, register_parser, enqueue_parse_job, };
import PgBoss from "pg-boss";
interface ParseFileJob {
    file_id: string;
    mime_type: string;
    file_path: string;
}
type ParseFileWorker = (job: PgBoss.Job<ParseFileJob>[]) => Promise<void>;
declare function run_PgBoss(): Promise<PgBoss>;
declare function make_parse_queue(boss: PgBoss): Promise<void>;
declare function register_parser(boss: PgBoss, worker: ParseFileWorker): Promise<void>;
declare function enqueue_parse_job(boss: PgBoss, job: ParseFileJob): Promise<void>;
//# sourceMappingURL=jobs.d.ts.map