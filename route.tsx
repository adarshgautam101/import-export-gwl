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
          <h1 className={styles.heading}>The Ultimate Shopify Data Engine</h1>
          <p className={styles.text}>
            Master your store's data with enterprise-grade import and export tools.
            Seamlessly manage B2B companies, collections, discounts, and metaobjects in one powerful platform.
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
                Access Dashboard
              </button>
            </Form>
          </section>
        )}

        <ul className={styles.features}>
          <li className={styles.featureCard}>
            <div className={styles.featureIcon}>
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="7" width="20" height="14" rx="2" ry="2" /><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" /></svg>
            </div>
            <strong className={styles.featureTitle}>Companies</strong>
            <p className={styles.featureText}>
              Manage B2B companies, sync locations, and handle complex customer assignments with ease.
            </p>
          </li>
          <li className={styles.featureCard}>
            <div className={styles.featureIcon}>
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" /><polyline points="3.27 6.96 12 12.01 20.73 6.96" /><line x1="12" y1="22.08" x2="12" y2="12" /></svg>
            </div>
            <strong className={styles.featureTitle}>Collections</strong>
            <p className={styles.featureText}>
              Bulk import and export smart and manual collections. Maintain hierarchy and product links perfectly.
            </p>
          </li>
          <li className={styles.featureCard}>
            <div className={styles.featureIcon}>
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" /><line x1="7" y1="7" x2="7.01" y2="7" /></svg>
            </div>
            <strong className={styles.featureTitle}>Discounts</strong>
            <p className={styles.featureText}>
              Create thousands of discount codes and automatic discounts in seconds using CSV automation.
            </p>
          </li>
          <li className={styles.featureCard}>
            <div className={styles.featureIcon}>
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2" /><polyline points="2 17 12 22 22 17" /><polyline points="2 12 12 17 22 12" /></svg>
            </div>
            <strong className={styles.featureTitle}>Metaobjects</strong>
            <p className={styles.featureText}>
              Full support for custom Metaobjects. Import and export dynamic fields with complete precision.
            </p>
          </li>
        </ul>
      </div>
    </div>
  );
}
