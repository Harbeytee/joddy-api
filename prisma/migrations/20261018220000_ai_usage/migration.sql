-- CreateTable
CREATE TABLE "ai_usage" (
    "day" DATE NOT NULL,
    "scope" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ai_usage_pkey" PRIMARY KEY ("day","scope")
);
