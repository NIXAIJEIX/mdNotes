export default function DocLoading() {
  return (
    <div className="flex h-screen flex-col bg-white">
      <div className="flex h-[52px] shrink-0 items-center gap-3 border-b border-gray-100 px-4">
        <div className="h-8 w-8 animate-pulse rounded-md bg-gray-100" />
        <div className="h-7 w-7 animate-pulse rounded-md bg-gray-100" />
        <div className="h-4 w-48 animate-pulse rounded bg-gray-100" />
        <div className="ml-auto h-7 w-16 animate-pulse rounded bg-gray-100" />
      </div>
      <div className="h-[44px] shrink-0 border-b border-gray-100" />
      <div className="mx-auto w-full max-w-[860px] px-8 py-10 md:px-16">
        <div className="space-y-3">
          {[92, 78, 86, 64, 88, 72, 50].map((w, i) => (
            <div
              key={i}
              className="h-3.5 animate-pulse rounded bg-gray-100"
              style={{ width: `${w}%` }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
