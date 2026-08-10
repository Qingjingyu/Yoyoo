"use client";

import { HomeExperience } from "@/components/home/home-experience";

export default function ErrorPage({ reset }: { reset: () => void }) {
  return <HomeExperience onRetry={reset} state="error" />;
}
