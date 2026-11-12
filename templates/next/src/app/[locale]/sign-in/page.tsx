import { publicPage } from "@/lib/roles";
import { SignInForm } from "./SignInForm";

export default publicPage("the sign-in form: it must be reachable before anyone is signed in", () => <SignInForm />);
