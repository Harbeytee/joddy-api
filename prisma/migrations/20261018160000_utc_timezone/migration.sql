-- Timestamps are stored as UTC in `timestamp` columns. Make UTC the default for every new session on
-- this database (psql, BI tools, raw SQL), whatever zone the server itself was set up with.
-- The app also requests UTC per connection, so lacking the privilege here is not fatal.
DO $$
BEGIN
  EXECUTE format('ALTER DATABASE %I SET timezone TO %L', current_database(), 'UTC');
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'Not allowed to set the database time zone; the app sets UTC per connection.';
END
$$;
