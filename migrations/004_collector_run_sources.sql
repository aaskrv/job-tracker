-- Manual runs can be limited to some of the profile's sources
ALTER TABLE collector_runs ADD COLUMN sources TEXT[];
