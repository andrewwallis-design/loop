import { LoginForm } from "./login-form";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next, error } = await searchParams;
  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="card w-full max-w-sm">
        <div className="mb-6">
          <div className="text-2xl font-semibold tracking-tight">Loop</div>
          <p className="mt-1 text-sm text-stone-600">Sign in with your work email. We’ll send you a link.</p>
        </div>
        {error && (
          <p className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>
        )}
        <LoginForm next={next ?? "/app"} />
      </div>
    </main>
  );
}
