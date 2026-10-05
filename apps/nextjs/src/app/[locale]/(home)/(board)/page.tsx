// SHIVA shell hook. Upstream boards remain available under /boards.
import { redirect } from "next/navigation";

export default function Page() {
  redirect("/shiva");
}
