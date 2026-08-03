-- One login per company, so the separation above is enforced by Postgres rather than being a
-- convention the application could quietly break. The regulator's connection string is refused by
-- the oracle's database, which is checkable with psql rather than taken on trust.
--
-- Honest limit: both databases live in one container under one superuser, and the freshmilk owner
-- can still reach both. Real isolation means separate instances. This is as far as one container
-- goes, and it is far enough to demonstrate the property.

CREATE ROLE oracle_app LOGIN PASSWORD 'oracle';
CREATE ROLE regulator_app LOGIN PASSWORD 'regulator';

-- Postgres grants CONNECT to PUBLIC by default, so without these revokes both roles could open
-- both databases and the grants below would mean nothing.
REVOKE CONNECT ON DATABASE freshmilk_oracle FROM PUBLIC;
REVOKE CONNECT ON DATABASE freshmilk_regulator FROM PUBLIC;

GRANT CONNECT ON DATABASE freshmilk_oracle TO oracle_app;
GRANT CONNECT ON DATABASE freshmilk_regulator TO regulator_app;

\connect freshmilk_oracle
GRANT USAGE ON SCHEMA public TO oracle_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO oracle_app;
-- temperature_readings.reading_id is a BIGSERIAL, and inserting into it needs the sequence too.
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO oracle_app;

\connect freshmilk_regulator
GRANT USAGE ON SCHEMA public TO regulator_app;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO regulator_app;
