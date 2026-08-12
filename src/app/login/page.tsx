import { HumanLogin } from "@/components/auth/human-login";

interface LoginPageProps {
  searchParams: Promise<{ next?: string | string[] }>;
}
export default async function LoginPage({ searchParams }: LoginPageProps) {
  const query = await searchParams;
  const nextPath = typeof query.next === "string" ? query.next : undefined;
  return <HumanLogin nextPath={nextPath} />;
}
