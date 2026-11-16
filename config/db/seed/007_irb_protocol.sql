-- 007_irb_protocol.sql
--
-- seeds the IRB Protocol Builder application, the first document
-- application: each of its chats writes one document from the irb-protocol
-- template. its routes are in
-- packages/aim_hi_webserver/src/application/irb-protocol.ts.
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
