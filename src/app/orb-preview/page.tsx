import Link from "next/link";

import { OrbPreview } from "@/components/orb/orb-preview";
import styles from "@/components/orb/orb-preview.module.css";

export default function OrbPreviewPage() {
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link className={styles.brand} href="/">
          Yoyoo Space
        </Link>
        <span>ORB STUDY / 01</span>
      </header>
      <OrbPreview />
    </main>
  );
}

