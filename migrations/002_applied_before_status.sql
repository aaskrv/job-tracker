-- "applied_before": I applied to this vacancy outside the tracker
ALTER TABLE vacancies DROP CONSTRAINT vacancies_status_check;
ALTER TABLE vacancies ADD CONSTRAINT vacancies_status_check
    CHECK (status IN ('new','shortlisted','skipped','closed','applied_before'));
