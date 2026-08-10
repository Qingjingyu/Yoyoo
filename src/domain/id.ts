import { z } from "zod";

// PostgreSQL accepts GUID-shaped UUID values independent of RFC variant bits.
// Legacy deterministic migrations produced valid database IDs with that wider shape.
export const databaseIdSchema = z.guid();
