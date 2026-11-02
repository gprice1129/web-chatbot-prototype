-- 005_statement_of_work.sql
--
-- seeds the Statement of Work application. a placeholder: its route in
-- packages/aim_hi_webserver/src/application/statement-of-work.ts is served
-- by the Ally chatbot until it gets a chatbot of its own.
--
-- idempotent: re-running the seed leaves an existing row untouched.

begin;

insert into applications (slug, name, description)
select
    'statement-of-work',
    'Statement of Work Generator',
    'Generate a detailed Statement of Work (SOW) from a project proposal. Edit the generated SOW directly, adjust the proposal, and regenerate new versions.'
where not exists (
    select 1 from applications where lower(slug) = lower('statement-of-work')
);

commit;
