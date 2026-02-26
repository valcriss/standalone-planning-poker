-- AlterTable
ALTER TABLE "User"
ADD COLUMN "jiraBaseUrl" TEXT,
ADD COLUMN "jiraEmail" TEXT,
ADD COLUMN "jiraApiTokenEncrypted" TEXT;

-- AlterTable
ALTER TABLE "PlanningPokerSession"
ADD COLUMN "jiraBaseUrl" TEXT,
ADD COLUMN "jiraEmail" TEXT,
ADD COLUMN "jiraApiTokenEncrypted" TEXT;

UPDATE "PlanningPokerSession"
SET
  "jiraBaseUrl" = '',
  "jiraEmail" = '',
  "jiraApiTokenEncrypted" = ''
WHERE "jiraBaseUrl" IS NULL OR "jiraEmail" IS NULL OR "jiraApiTokenEncrypted" IS NULL;

ALTER TABLE "PlanningPokerSession"
ALTER COLUMN "jiraBaseUrl" SET NOT NULL,
ALTER COLUMN "jiraEmail" SET NOT NULL,
ALTER COLUMN "jiraApiTokenEncrypted" SET NOT NULL;
