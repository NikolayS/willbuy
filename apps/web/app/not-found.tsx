export default function NotFound() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-24 text-center">
      <p className="text-sm font-medium uppercase tracking-wide text-gray-400">404</p>
      <h1 className="mt-2 text-3xl font-bold tracking-tight text-gray-900">Page not found</h1>
      <p className="mt-4 text-gray-600">
        The page you were looking for doesn&apos;t exist or has been moved.
      </p>
      <div className="mt-8 flex flex-wrap justify-center gap-4">
        <a
          href="/"
          className="rounded-md bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
        >
          Go home
        </a>
        <a
          href="/dashboard"
          className="rounded-md border border-gray-300 px-5 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Dashboard
        </a>
      </div>
    </main>
  );
}
