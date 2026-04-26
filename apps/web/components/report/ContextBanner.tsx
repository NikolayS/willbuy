// ContextBanner — shows which URL(s) were tested, displayed above the report.
// Single-variant: "Page tested: <url>"
// Paired A/B: "A: <url-a>  vs  B: <url-b>"

interface ContextBannerProps {
  urls: string[];
}

export function ContextBanner({ urls }: ContextBannerProps) {
  if (urls.length === 0) return null;

  return (
    <div className="mb-6 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700">
      {urls.length === 1 ? (
        <span>
          <span className="font-medium text-gray-500">Page tested:&nbsp;</span>
          <a
            href={urls[0]}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 underline underline-offset-2 hover:text-blue-800 break-all"
          >
            {urls[0]}
          </a>
        </span>
      ) : (
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span>
            <span className="font-semibold">A:&nbsp;</span>
            <a
              href={urls[0]}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 underline underline-offset-2 hover:text-blue-800 break-all"
            >
              {urls[0]}
            </a>
          </span>
          <span className="text-gray-400">vs</span>
          <span>
            <span className="font-semibold">B:&nbsp;</span>
            <a
              href={urls[1]}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 underline underline-offset-2 hover:text-blue-800 break-all"
            >
              {urls[1]}
            </a>
          </span>
        </span>
      )}
    </div>
  );
}
