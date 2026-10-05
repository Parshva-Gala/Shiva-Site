import classes from "./fallback.module.css";

export default function CommonLoading() {
  return (
    <output className={classes.center} aria-busy="true">
      <span className={classes.spinner} aria-hidden="true" />
      <span>Loading…</span>
    </output>
  );
}
