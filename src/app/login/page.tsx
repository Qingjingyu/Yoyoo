import { HumanLogin } from "@/components/auth/human-login";

interface LoginPageProps {
  searchParams: Promise<{
    next?: string | string[];
    aicard?: string | string[];
  }>;
}
export default async function LoginPage({ searchParams }: LoginPageProps) {
  const query = await searchParams;
  const nextPath = typeof query.next === "string" ? query.next : undefined;
  const result = typeof query.aicard === "string" ? query.aicard : undefined;
  const authorizationError = result
    ? result === "denied"
      ? "你取消了 AI Card 授权，可以重新尝试。"
      : result === "unavailable"
        ? "AI Card 暂时不可用，请稍后再试。"
        : result === "workspace_denied"
          ? "AI Card 身份有效，但当前 Yoyoo 空间尚未向你开放。"
        : "AI Card 身份验证失败，请重新尝试。"
    : undefined;
  return (
    <HumanLogin
      authorizationError={authorizationError}
      nextPath={nextPath}
    />
  );
}
