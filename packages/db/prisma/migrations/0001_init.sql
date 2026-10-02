-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "ReceiptStatus" AS ENUM ('UPLOADED', 'PARSING', 'PARSED', 'PARSE_FAILED', 'FINALIZED');

-- CreateEnum
CREATE TYPE "SplitMode" AS ENUM ('EVEN', 'ITEMIZED');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "parties" (
    "id" TEXT NOT NULL,
    "organizer_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "share_token" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "parties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "party_members" (
    "id" TEXT NOT NULL,
    "party_id" TEXT NOT NULL,
    "user_id" TEXT,
    "display_name" TEXT NOT NULL,
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "party_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receipts" (
    "id" TEXT NOT NULL,
    "party_id" TEXT NOT NULL,
    "uploaded_by_id" TEXT NOT NULL,
    "paid_by_member_id" TEXT,
    "status" "ReceiptStatus" NOT NULL DEFAULT 'UPLOADED',
    "split_mode" "SplitMode" NOT NULL DEFAULT 'EVEN',
    "image_blob_name" TEXT NOT NULL,
    "image_content_type" TEXT NOT NULL,
    "extraction" JSONB,
    "parse_error" TEXT,
    "merchant_name" TEXT,
    "address" TEXT,
    "purchased_at" TIMESTAMP(3),
    "currency" CHAR(3) NOT NULL DEFAULT 'USD',
    "subtotal" DECIMAL(12,2),
    "tax" DECIMAL(12,2),
    "tip" DECIMAL(12,2),
    "total" DECIMAL(12,2),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receipt_items" (
    "id" TEXT NOT NULL,
    "receipt_id" TEXT NOT NULL,
    "line_number" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "quantity" DECIMAL(10,3) NOT NULL DEFAULT 1,
    "unit_price" DECIMAL(12,2) NOT NULL,
    "total_price" DECIMAL(12,2) NOT NULL,
    "is_verified" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "receipt_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "item_shares" (
    "item_id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "weight" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "item_shares_pkey" PRIMARY KEY ("item_id","member_id")
);

-- CreateTable
CREATE TABLE "bills" (
    "id" TEXT NOT NULL,
    "receipt_id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "subtotal" DECIMAL(12,2) NOT NULL,
    "tax_share" DECIMAL(12,2) NOT NULL,
    "tip_share" DECIMAL(12,2) NOT NULL,
    "amount_owed" DECIMAL(12,2) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "bill_id" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "paid_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_key" ON "users"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "parties_share_token_key" ON "parties"("share_token");

-- CreateIndex
CREATE INDEX "parties_organizer_id_idx" ON "parties"("organizer_id");

-- CreateIndex
CREATE INDEX "party_members_user_id_idx" ON "party_members"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "party_members_party_id_user_id_key" ON "party_members"("party_id", "user_id");

-- CreateIndex
CREATE INDEX "receipts_party_id_idx" ON "receipts"("party_id");

-- CreateIndex
CREATE INDEX "receipts_uploaded_by_id_idx" ON "receipts"("uploaded_by_id");

-- CreateIndex
CREATE UNIQUE INDEX "receipt_items_receipt_id_line_number_key" ON "receipt_items"("receipt_id", "line_number");

-- CreateIndex
CREATE INDEX "item_shares_member_id_idx" ON "item_shares"("member_id");

-- CreateIndex
CREATE INDEX "bills_member_id_idx" ON "bills"("member_id");

-- CreateIndex
CREATE UNIQUE INDEX "bills_receipt_id_member_id_key" ON "bills"("receipt_id", "member_id");

-- CreateIndex
CREATE INDEX "payments_bill_id_idx" ON "payments"("bill_id");

-- AddForeignKey
ALTER TABLE "parties" ADD CONSTRAINT "parties_organizer_id_fkey" FOREIGN KEY ("organizer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "party_members" ADD CONSTRAINT "party_members_party_id_fkey" FOREIGN KEY ("party_id") REFERENCES "parties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "party_members" ADD CONSTRAINT "party_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_party_id_fkey" FOREIGN KEY ("party_id") REFERENCES "parties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_paid_by_member_id_fkey" FOREIGN KEY ("paid_by_member_id") REFERENCES "party_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipt_items" ADD CONSTRAINT "receipt_items_receipt_id_fkey" FOREIGN KEY ("receipt_id") REFERENCES "receipts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_shares" ADD CONSTRAINT "item_shares_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "receipt_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_shares" ADD CONSTRAINT "item_shares_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "party_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bills" ADD CONSTRAINT "bills_receipt_id_fkey" FOREIGN KEY ("receipt_id") REFERENCES "receipts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bills" ADD CONSTRAINT "bills_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "party_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_bill_id_fkey" FOREIGN KEY ("bill_id") REFERENCES "bills"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
