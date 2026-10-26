-- CreateEnum
CREATE TYPE "Role" AS ENUM ('STUDENT', 'TEACHER', 'ADMIN');

-- CreateEnum
CREATE TYPE "FacilityType" AS ENUM ('POOL', 'GYM', 'FOOTBALL', 'BASKETBALL');

-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('ACTIVE', 'CANCELLED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "CancelledBy" AS ENUM ('USER', 'ADMIN', 'MAINTENANCE');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "blocked" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Facility" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "type" "FacilityType" NOT NULL,
    "openTime" INTEGER NOT NULL,
    "closeTime" INTEGER NOT NULL,
    "capacityPerSlot" INTEGER NOT NULL,
    "studentDailyLimitMinutes" INTEGER NOT NULL,
    "archivedAt" TIMESTAMPTZ,

    CONSTRAINT "Facility_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FacilityUnit" (
    "id" UUID NOT NULL,
    "facilityId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "archivedAt" TIMESTAMPTZ,

    CONSTRAINT "FacilityUnit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Booking" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "unitId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "startTime" INTEGER NOT NULL,
    "endTime" INTEGER NOT NULL,
    "status" "BookingStatus" NOT NULL DEFAULT 'ACTIVE',
    "cancelledBy" "CancelledBy",
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Booking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaintenanceBlock" (
    "id" UUID NOT NULL,
    "facilityId" UUID NOT NULL,
    "unitId" UUID,
    "startsAt" TIMESTAMPTZ NOT NULL,
    "endsAt" TIMESTAMPTZ NOT NULL,
    "reason" TEXT,
    "createdById" UUID NOT NULL,

    CONSTRAINT "MaintenanceBlock_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "FacilityUnit_facilityId_name_key" ON "FacilityUnit"("facilityId", "name");

-- CreateIndex
CREATE INDEX "Booking_unitId_date_status_idx" ON "Booking"("unitId", "date", "status");

-- CreateIndex
CREATE INDEX "Booking_userId_date_status_idx" ON "Booking"("userId", "date", "status");

-- CreateIndex
CREATE INDEX "MaintenanceBlock_facilityId_startsAt_endsAt_idx" ON "MaintenanceBlock"("facilityId", "startsAt", "endsAt");

-- AddForeignKey
ALTER TABLE "FacilityUnit" ADD CONSTRAINT "FacilityUnit_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "FacilityUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceBlock" ADD CONSTRAINT "MaintenanceBlock_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceBlock" ADD CONSTRAINT "MaintenanceBlock_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "FacilityUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceBlock" ADD CONSTRAINT "MaintenanceBlock_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Constraints Prisma cannot express. Times are minutes since midnight; 1440 = end-of-day midnight.
ALTER TABLE "Facility"
  ADD CONSTRAINT "Facility_hours_check" CHECK ("openTime" >= 0 AND "closeTime" <= 1440 AND "closeTime" > "openTime"),
  ADD CONSTRAINT "Facility_slot_grid_check" CHECK ("openTime" % 30 = 0 AND "closeTime" % 30 = 0),
  ADD CONSTRAINT "Facility_capacity_check" CHECK ("capacityPerSlot" >= 1),
  ADD CONSTRAINT "Facility_daily_limit_check" CHECK ("studentDailyLimitMinutes" >= 30 AND "studentDailyLimitMinutes" % 30 = 0);

ALTER TABLE "Booking"
  ADD CONSTRAINT "Booking_time_check" CHECK ("startTime" >= 0 AND "endTime" <= 1440 AND "endTime" > "startTime"),
  ADD CONSTRAINT "Booking_slot_grid_check" CHECK ("startTime" % 30 = 0 AND "endTime" % 30 = 0),
  ADD CONSTRAINT "Booking_status_check" CHECK ("status" <> 'COMPLETED'),
  ADD CONSTRAINT "Booking_cancelled_by_check" CHECK (("status" = 'CANCELLED') = ("cancelledBy" IS NOT NULL));

ALTER TABLE "MaintenanceBlock"
  ADD CONSTRAINT "MaintenanceBlock_time_check" CHECK ("endsAt" > "startsAt");
