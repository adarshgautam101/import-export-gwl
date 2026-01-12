import { Links, Meta, Outlet, Scripts, ScrollRestoration, useNavigation } from "react-router";
import { useEffect, useState } from "react";

import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];

export default function App() {
  const navigation = useNavigation();
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (navigation.state === "loading") {
      setIsLoading(true);
    } else {
      // Small delay to make it feel smoother
      const timer = setTimeout(() => setIsLoading(false), 300);
      return () => clearTimeout(timer);
    }
  }, [navigation.state]);

  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <link rel="preconnect" href="https://cdn.shopify.com/" />
        <link
          rel="stylesheet"
          href="https://cdn.shopify.com/static/fonts/inter/v4/styles.css"
        />
        <Meta />
        <Links />
        <style>{`
          #loading-bar {
            position: fixed;
            top: 0;
            left: 0;
            height: 3px;
            background: #008060;
            z-index: 9999;
            transition: width 0.3s ease-in-out, opacity 0.3s ease-in-out;
            box-shadow: 0 0 10px rgba(0, 128, 96, 0.5);
          }
        `}</style>
      </head>
      <body>
        {isLoading && (
          <div
            id="loading-bar"
            style={{
              width: navigation.state === "loading" ? "70%" : "100%",
              opacity: navigation.state === "loading" ? 1 : 0,
            }}
          />
        )}
        <Outlet />
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}
