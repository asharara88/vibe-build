import { NoAccess } from "@/components/NoAccess";
import { publicPage } from "@/lib/roles";

// Where a form action sends someone whose role may not run it. It shows no data.
export default publicPage("the plain \"no access\" message: it shows no data and must be readable by someone who was just refused", () => (
  <NoAccess reason="action" role={null} allowed={[]} />
));
