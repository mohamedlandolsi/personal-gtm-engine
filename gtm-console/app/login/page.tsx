import { login } from "./actions";

// Reads searchParams at request time; nothing here is worth prerendering.
export const instant = false;

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; e?: string }>;
}) {
  const { next = "/queue", e } = await searchParams;
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <form action={login} className="w-full max-w-sm space-y-4 rounded-xl border p-6">
        <h1 className="text-lg font-semibold">GTM Console</h1>
        <input type="hidden" name="next" value={next} />
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          required
          placeholder="Password"
          className="w-full rounded-md border px-3 py-2"
        />
        {e ? <p className="text-sm text-red-600">Wrong password.</p> : null}
        <button type="submit" className="w-full rounded-md bg-black px-3 py-2 text-white">
          Sign in
        </button>
      </form>
    </main>
  );
}
