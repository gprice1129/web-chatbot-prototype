-- 006_learning_assistant.sql
--
-- seeds the Learning Assistant application. a placeholder: its route in
-- packages/aim_hi_webserver/src/application/learning-assistant.ts is served
-- by the Ally chatbot until it gets a chatbot of its own.
--
-- idempotent: re-running the seed leaves an existing row untouched.

begin;

insert into applications (slug, name, description)
select
    'learning-assistant',
    'Learning Assistant',
    'Answers questions about the current lesson and runs prompt-writing practice inside the learning courses.'
where not exists (
    select 1 from applications where lower(slug) = lower('learning-assistant')
);

commit;
