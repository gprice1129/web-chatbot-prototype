export { run_PgBoss, make_parse_queue, register_parser, enqueue_parse_job, };
import PgBoss from "pg-boss";
// TODO:[jobs] this is just for file parsing. If we add more jobs later we should break this up
async function run_PgBoss() {
    // TODO:[jobs] add configuration
    const boss = new PgBoss({
        host: process.env["PGHOST"],
        port: process.env["PGPORT"] ? Number(process.env["PGPORT"]) : undefined,
        user: process.env["PGUSER"],
        password: process.env["PGPASSWORD"],
        database: process.env["PGDATABASE"],
    });
    boss.on("error", (err) => console.error("pg-boss error:", err));
    await boss.start();
    return boss;
}
async function make_parse_queue(boss) {
    return boss.createQueue(_QUEUE_PARSE_FILE);
}
async function register_parser(boss, worker) {
    await boss.work(_QUEUE_PARSE_FILE, worker);
}
async function enqueue_parse_job(boss, job) {
    await boss.send(_QUEUE_PARSE_FILE, job);
}
const _QUEUE_PARSE_FILE = "parse_file";
