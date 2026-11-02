// Minimal catalog/RLS fixture for SQL policy tests; not a Storage HTTP emulator.
export async function storageFixture(db) {
  await db.exec(`create schema storage;
    create table storage.buckets(id text primary key,name text,public boolean default false,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text not null,owner_id text,unique(bucket_id,name));
    alter table storage.objects enable row level security;
    alter table storage.objects force row level security;
    grant usage on schema storage to anon,authenticated;
    grant select,insert,update,delete on storage.objects to authenticated;
  `);
}
