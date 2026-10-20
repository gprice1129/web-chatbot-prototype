-- 007_irb_protocol.sql
--
-- seeds the IRB Protocol Builder application, the first document-builder app:
-- a guided conversation that drafts an IRB protocol for a secondary data
-- analysis with a waiver of consent. a placeholder: its route in
-- packages/aim_hi_webserver/src/application/irb-protocol.ts is served by the
-- Ally chatbot until the document-builder chatbot lands.
--
-- idempotent: re-running the seed leaves an existing row untouched.

begin;

insert into applications (slug, name, description)
select
    'irb-protocol',
    'IRB Protocol Builder',
    'Drafts an IRB protocol for a secondary data analysis through a guided conversation, filling in the protocol document as you answer.'
where not exists (
    select 1 from applications where lower(slug) = lower('irb-protocol')
);

commit;
