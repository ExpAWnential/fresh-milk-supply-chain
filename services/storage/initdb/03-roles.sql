-- Separate application logins enforce the oracle and regulator database boundary. The shared
-- container owner remains a proof-of-concept limitation. Production isolation needs separate instances.

CREATE ROLE oracle_app LOGIN PASSWORD 'oracle';
CREATE ROLE regulator_app LOGIN PASSWORD 'regulator';

-- Remove PostgreSQL's default public connection access before granting each role one database.
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
