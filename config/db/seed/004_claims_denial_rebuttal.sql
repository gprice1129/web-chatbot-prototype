-- 004_claims_denial_rebuttal.sql
--
-- seeds the Claims Denial Rebuttal application. a placeholder: its route in
-- packages/aim_hi_webserver/src/application/claims-denial-rebuttal.ts is
-- served by the Ally chatbot until it gets a chatbot of its own.
--
-- idempotent: re-running the seed leaves an existing row untouched.

begin;

insert into applications (slug, name, description)
select
    'claims-denial-rebuttal',
    'Claims Denial Rebuttal Generator',
    'Generate a formal appeal letter for an insurance claims denial, citing clinical evidence and payer policy to support medical necessity and overturn the decision.'
where not exists (
    select 1 from applications where lower(slug) = lower('claims-denial-rebuttal')
);

commit;
