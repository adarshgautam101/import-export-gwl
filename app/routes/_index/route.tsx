import type { LoaderFunctionArgs } from "react-router";
import { redirect, Form, useLoaderData } from "react-router";

import { login } from "../../shopify.server";

import styles from "./styles.module.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  return { showForm: Boolean(login) };
};

export default function App() {
  const { showForm } = useLoaderData<typeof loader>();

  return (
    <div className={styles.index}>
      <div className={styles.content}>
        <header className={styles.hero}>
          <h1 className={styles.heading}>Seamless Import & Export</h1>
          <p className={styles.text}>
            The most powerful way to manage your Shopify data. Effortlessly sync collections, companies, and discounts with precision.
          </p>
        </header>

        {showForm && (
          <section className={styles.loginSection}>
            <Form className={styles.form} method="post" action="/auth/login">
              <label className={styles.label}>
                <span>Shop domain</span>
                <input
                  className={styles.input}
                  type="text"
                  name="shop"
                  placeholder="my-shop-domain.myshopify.com"
                  required
                />
                <span>Enter your Shopify store URL to get started</span>
              </label>
              <button className={styles.button} type="submit">
                Get Started
              </button>
            </Form>
          </section>
        )}

        <ul className={styles.features}>
          <li className={styles.featureCard}>
            <div className={styles.featureIcon}>
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
            </div>
            <strong className={styles.featureTitle}>Bulk Import</strong>
            <p className={styles.featureText}>
              Import thousands of records in seconds. Supports CSV formats for collections, companies, and more.
            </p>
          </li>
          <li className={styles.featureCard}>
            <div className={styles.featureIcon}>
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>
            </div>
            <strong className={styles.featureTitle}>Precision Export</strong>
            <p className={styles.featureText}>
              Export your data with custom filters and formatting. Perfect for backups or migrating between stores.
            </p>
          </li>
          <li className={styles.featureCard}>
            <div className={styles.featureIcon}>
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>
            </div>
            <strong className={styles.featureTitle}>Secure Sync</strong>
            <p className={styles.featureText}>
              Enterprise-grade security for your data. We ensure every import and export is handled with care.
            </p>
          </li>
        </ul>
      </div>
    </div>
  );
}
