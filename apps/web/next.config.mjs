/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  // @willbuy/shared is a workspace TS package whose internal imports
  // use `.js` suffixes (Node16 ESM convention). transpilePackages
  // routes it through Next's loader; the webpack `extensionAlias`
  // teaches the resolver that `.js` may resolve to a `.ts` source.
  transpilePackages: ['@willbuy/shared'],
  webpack(config) {
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias ?? {}),
      '.js': ['.ts', '.tsx', '.js', '.jsx'],
    };
    return config;
  },
};

export default nextConfig;
