-- 002_ally.sql
--
-- seeds the Ally application. backed by the chatbot in
-- packages/aim_hi_chatbot/src/bot/ally.ts -- a general-purpose,
-- conversational assistant for UAB / Hugh Kaul Precision Medicine work
-- that also points users to the site's other applications.
--
-- idempotent: re-running the seed leaves an existing row untouched.

begin;

insert into applications (slug, name, description)
select
    'ally',
    'Ally',
    'A general assistant for questions about UAB and the Hugh Kaul Precision Medicine Institute, and a guide to the site''s other tools.'
where not exists (
    select 1 from applications where lower(slug) = lower('ally')
);

commit;
