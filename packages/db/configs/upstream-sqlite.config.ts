import upstream from "./sqlite.config";

export default {
  ...upstream,
  schema: "./schema/upstream/sqlite.ts",
};
