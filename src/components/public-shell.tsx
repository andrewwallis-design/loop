export function PublicShell({
  title,
  logoUrl,
  brandColour = "#1f5f8b",
  children,
}: {
  title: string;
  logoUrl?: string | null;
  brandColour?: string;
  children: React.ReactNode;
}) {
  return (
    <main className="flex flex-1 flex-col">
      <div className="h-2 w-full" style={{ background: brandColour }} />
      <div className="mx-auto w-full max-w-xl px-5 py-8">
        <div className="mb-6 flex items-center gap-3">
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt="" className="h-10 w-auto" />
          ) : (
            <div className="flex h-10 w-10 items-center justify-center rounded-lg text-lg font-bold text-white" style={{ background: brandColour }}>
              {title.charAt(0)}
            </div>
          )}
          <div className="text-xl font-semibold">{title}</div>
        </div>
        {children}
        <p className="mt-10 text-center text-xs text-stone-400">Powered by Loop</p>
      </div>
    </main>
  );
}
