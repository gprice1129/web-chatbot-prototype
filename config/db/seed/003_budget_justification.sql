-- 003_budget_justification.sql
--
-- seeds the Budget Justification application. a placeholder: its route in
-- packages/aim_hi_webserver/src/application/budget-justification.ts is served
-- by the Ally chatbot until it gets a chatbot of its own.
--
-- idempotent: re-running the seed leaves an existing row untouched.

begin;

insert into applications (slug, name, description)
select
    'budget-justification',
    'Budget Justification Generator',
    'Generate a detailed budget justification narrative from a grant proposal and budget spreadsheet. Edit, update inputs, and regenerate as needed.'
where not exists (
    select 1 from applications where lower(slug) = lower('budget-justification')
);

commit;
