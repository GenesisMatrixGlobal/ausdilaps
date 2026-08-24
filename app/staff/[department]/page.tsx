import { redirect } from "next/navigation";

/** A department always lands on its Tools tab. */
export default async function DepartmentIndexPage({
  params,
}: {
  params: Promise<{ department: string }>;
}) {
  const { department } = await params;
  redirect(`/staff/${department}/tools`);
}
