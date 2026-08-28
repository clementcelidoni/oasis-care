import { redirect } from "next/navigation";

/** /crm est un regroupement de navigation, pas un écran. */
export default function CrmIndexPage() {
  redirect("/crm/clients");
}
