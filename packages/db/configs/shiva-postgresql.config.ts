import upstream from "./postgresql.config";

export default {
  ...upstream,
  schema: "./schema/shiva-postgresql.ts",
  out: "./migrations/shiva/postgresql",
};
