import clsx from "clsx";
import Link from "@docusaurus/Link";
import useDocusaurusContext from "@docusaurus/useDocusaurusContext";
import Layout from "@theme/Layout";

import styles from "./index.module.css";

function HomepageHeader() {
  const { siteConfig } = useDocusaurusContext();
  return (
    <header className={clsx("hero hero--primary", styles.heroBanner)}>
      <div className="container">
        <h1 className="hero__title">{siteConfig.title}</h1>
        <p className="hero__subtitle">{siteConfig.tagline}</p>
        <div className={styles.buttons}>
          <Link
            className="button button--secondary button--lg"
            to="/docs/implementation-guide"
          >
            Get Started
          </Link>
        </div>
      </div>
    </header>
  );
}

const features = [
  {
    title: "Backend",
    description:
      "NestJS REST API with Fastify, Supabase auth, multi-schema PostgreSQL, and pluggable caching.",
    link: "/docs/backend/overview",
  },
  {
    title: "Frontend",
    description:
      "Next.js 16 app with App Router, Preact Signals, Tailwind CSS v4, and client-side PDF/Excel generation.",
    link: "/docs/frontend/overview",
  },
  {
    title: "CLI",
    description:
      "Monorepo-aware Git tool that scopes commits and branches to individual services.",
    link: "/docs/cli/overview",
  },
];

export default function Home() {
  const { siteConfig } = useDocusaurusContext();
  return (
    <Layout title="Home" description={siteConfig.tagline}>
      <HomepageHeader />
      <main>
        <section className={styles.features}>
          <div className="container">
            <div className="row">
              {features.map(({ title, description, link }) => (
                <div key={title} className={clsx("col col--4")}>
                  <div className="text--center padding-horiz--md padding-vert--lg">
                    <h3>
                      <Link to={link}>{title}</Link>
                    </h3>
                    <p>{description}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>
    </Layout>
  );
}
