# Receipt OCR fixture

receipt-ocr.png is a synthetic printed receipt created for this repository,
with explicit quantities and unit prices. It contains no personal data and
has no external licensing restrictions. The opt-in receipts-ocr.test.ts runs
the actual OCR engine against its pixels and verifies persisted lines/totals.

Expected items: one Soup at 10.00 and one Tea at 3.00. Subtotal 13.00,
tax 1.00, tip 2.00, total 16.00. OCR success never confirms review.
