const baseUrl = process.env.SMOKE_BASE_URL || "http://127.0.0.1:3000";
const routes = [
    "/",
    "/sign-in",
    "/pricing",
    "/checkout",
    "/thanks",
    "/updates-and-faq",
    "/applications",
    "/audio-generation",
    "/code-generation",
    "/education-feedback",
    "/generation-socials-post",
    "/photo-editing",
    "/video-generation",
    "/pagelist",
];

function fail(message) {
    console.error(`[smoke:routes] FAIL: ${message}`);
    process.exit(1);
}

function pass(message) {
    console.log(`[smoke:routes] ${message}`);
}

async function main() {
    for (const route of routes) {
        const url = `${baseUrl}${route}`;
        const res = await fetch(url);
        if (!res.ok) {
            fail(`${route} status ${res.status}`);
        }
    }
    pass(`routes stable (${routes.length} routes, all 200)`);
}

main().catch((error) =>
    fail(error instanceof Error ? error.message : String(error))
);

