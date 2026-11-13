import { redirect } from "@/i18n/navigation";
import { publicPage, whoIsAsking } from "@/lib/roles";

export default publicPage("shows nothing: it only sends a visitor to the home page or to sign-in", async ({ locale }) => {
  const who = await whoIsAsking();
  return redirect({ href: who.kind === "nobody" ? "/sign-in" : "/home", locale });
});
