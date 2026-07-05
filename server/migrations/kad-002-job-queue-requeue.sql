-- kad-002: track "superseded while leased" so a resume_task job that gets a
-- new dedup-key trigger WHILE its previous turn is still actively running
-- (status='leased') is requeued with the new payload instead of silently
-- discarding it once the in-flight turn completes. See jobs.js enqueue()/
-- completeOrRequeue() and job-queue.js runOne().
ALTER TABLE kad_job_queue ADD COLUMN requeue_after_done INTEGER NOT NULL DEFAULT 0;
