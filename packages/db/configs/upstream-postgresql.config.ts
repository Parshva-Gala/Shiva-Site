import upstream from "./postgresql.config";

export default {
  ...upstream,
  schema: "./schema/upstream/postgresql.ts",
};
