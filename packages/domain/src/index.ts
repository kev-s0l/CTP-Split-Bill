// Web-only domain logic: input validation schemas and database queries.
// Imported by apps/web only — ADR-0009.
export * from "./errors";
export * from "./parties";

//Export for Bills API
import {getBill, listBills} from @project/packages/domain/src/bills.ts
export {getBill, listBills}

