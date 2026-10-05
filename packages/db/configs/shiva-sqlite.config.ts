import upstream from "./sqlite.config";

export default {
  ...upstream,
  schema: "./schema/shiva-sqlite.ts",
  out: "./migrations/shiva/sqlite",
};
