-- 001_grant_reviewer.sql
--
-- seeds the Grant Reviewer application. backed by the chatbot in
-- packages/aim_hi_chatbot/src/bot/grant_reviewer.ts (modes: standard,
-- summary, technical, scored, aims).
--
-- idempotent: re-running the seed leaves an existing row untouched.

begin;

insert into applications (slug, name, description)
select
    'grant-reviewer',
    'Grant Reviewer',
    'Review a grant proposal against a Request for Application (RFA) and receive a detailed critique with actionable suggestions for improvement.'
where not exists (
    select 1 from applications where lower(slug) = lower('grant-reviewer')
);

commit;
